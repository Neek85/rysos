import json
import math
import mimetypes
import os
import re
import sys
import shutil
import tempfile
import uuid
import zipfile
from datetime import datetime
from pathlib import Path

from shapely.geometry import mapping
import fiona
import geopandas as gpd
import numpy as np
import pandas as pd
from supabase import create_client, Client

EVIDENCIA_BUCKET = "evidencias_eudr"
PHOTO_EXTENSIONS = {".jpg", ".jpeg", ".png"}
ARCHIVE_FILENAME_PATTERN = re.compile(r"^PROCESADO_\d{8}_\d{6}_.+\.zip$")
INBOX_DIRNAME = "RYZOS_INBOX"
ARCHIVE_DIRNAME = "RYZOS_ARCHIVE"
INVALID_DATE_TOKENS = {"", "none", "nan", "nat", "null"}

MONITOREO_TABLE = "EUDR_MONITOREO"
USO_SUELO_TABLE = "EUDR_USO_SUELO"
INSTALACIONES_TABLE = "EUDR_INSTALACIONES"
MONITOREO_LAYER_PREFIX = "EUDR_MONITOREO"
USO_SUELO_LAYER_PREFIX = "EUDR_USO_SUELO"
INSTALACIONES_LAYER_PREFIX = "EUDR_INSTALACIONES"

# INVARIANTE: un GeoPackage de QField puede traer varias capas vectoriales, cada una
# destinada a una tabla distinta; se clasifica por prefijo de nombre de capa, nunca
# por posicion u orden dentro del archivo.
LAYER_PREFIX_TABLE_MAP = (
    (MONITOREO_LAYER_PREFIX, MONITOREO_TABLE),
    (USO_SUELO_LAYER_PREFIX, USO_SUELO_TABLE),
    (INSTALACIONES_LAYER_PREFIX, INSTALACIONES_TABLE),
)

# INVARIANTE: solo estas tablas tienen columna evidencia_foto; las demas nunca
# intentan asociar una foto subida a Supabase Storage.
TABLES_WITH_EVIDENCIA_FOTO = (MONITOREO_TABLE, INSTALACIONES_TABLE)

# Sentinela para distinguir "no se paso evidencia_foto" (usar el valor crudo de la fila)
# de "se paso explicitamente None" (ya se intento subir la foto y no habia ninguna).
_UNSET = object()

# INVARIANTE: namespace fijo (arbitrario, nunca cambiar) para derivar UUIDs
# deterministicos vía uuid5. La misma clave natural siempre produce el mismo id,
# lo que hace que un upsert repetido sobre ON CONFLICT nunca "pise" el id de un
# registro existente con un uuid4 aleatorio nuevo.
RYZOS_DEDUP_NAMESPACE = uuid.UUID("2f6c9d1e-9b0a-4b7e-9c1a-8e3f2a6d5b4f")

# INVARIANTE: QField exporta la capa de monitoreo y sus atributos con nombres que
# varian segun la version del formulario de campo; se resuelve por orden de prioridad,
# prefiriendo siempre el identificador estricto (ID/codigo) cuando esta presente. Los
# candidatos de nombre libre (persona/parcela) nunca se mezclan en una columna de ID
# estricto: se capturan aparte (nuevo_productor_nombre / observaciones) para no
# corromper una columna pensada como identificador formal.
SOCIO_ID_CANDIDATES = ("ID_Socio",)
PARCELA_STRICT_CANDIDATES = ("ID_Parcela_Fija", "ID_Parcela", "parcela_codigo", "Codigo")
PARCELA_NOMBRE_CANDIDATES = ("parcela_nombre", "Parcela")
PARCELA_FIELD_CANDIDATES = PARCELA_STRICT_CANDIDATES + PARCELA_NOMBRE_CANDIDATES
PRODUCTOR_NOMBRE_CANDIDATES = (
    "nuevo_productor_nombre",
    "productor",
    "nombre_productor",
    "socio_nombre_completo",
    "socio_nombre",
    "Productor",
    "Nombre",
)
EVIDENCIA_FOTO_CANDIDATES = ("evidencia_foto", "foto")


class DriveZipETLPipeline:
    def __init__(self, supabase_url: str, supabase_key: str, drive_root: str):
        self.supabase: Client = create_client(supabase_url, supabase_key)
        # INVARIANTE: drive_root es la carpeta RYZOS_CLIENTES; cada organizacion es una
        # subcarpeta directa con su propio INBOX/ y ARCHIVE/ (jerarquia tenant-first).
        self.drive_root = Path(drive_root)

    def discover_packages(self) -> list[Path]:
        if not self.drive_root.exists():
            return []
        return sorted(self.drive_root.glob(f"*/{INBOX_DIRNAME}/*.zip"))

    def get_org_id_from_path(self, zip_path: Path) -> str:
        # INVARIANTE: la organizacion se deriva de RYZOS_CLIENTES/{ID_Organizacion}/,
        # dos niveles arriba del .zip (padre inmediato = INBOX/), nunca del nombre del archivo.
        return zip_path.parent.parent.name

    def extract_package(self, zip_path: Path, dest_dir: Path) -> Path:
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(dest_dir)
        self.extract_nested_zips(dest_dir)
        return dest_dir

    def extract_nested_zips(self, extracted_dir: Path) -> None:
        # INVARIANTE: QField a veces empaqueta las fotos en un .zip anidado dentro del
        # paquete principal (ej. DCIM.zip); se descomprime en el lugar recursivamente,
        # repitiendo la busqueda hasta que no queden .zip sin procesar, para soportar
        # cualquier nivel de anidamiento (zip dentro de zip dentro de zip...).
        processed: set[Path] = set()
        while True:
            nested_zips = [
                p for p in extracted_dir.rglob("*.zip") if p.is_file() and p not in processed
            ]
            if not nested_zips:
                break
            for nested_zip in nested_zips:
                processed.add(nested_zip)
                try:
                    with zipfile.ZipFile(nested_zip, "r") as zf:
                        zf.extractall(nested_zip.parent)
                except zipfile.BadZipFile:
                    continue

    def find_geo_layer(self, extracted_dir: Path) -> Path | None:
        gpkg_files = sorted(extracted_dir.rglob("*.gpkg"))
        if gpkg_files:
            return gpkg_files[0]
        geojson_files = sorted(extracted_dir.rglob("*.geojson"))
        if geojson_files:
            return geojson_files[0]
        return None

    def list_layer_names(self, geo_path: Path) -> list[str]:
        try:
            return list(fiona.listlayers(str(geo_path)))
        except Exception:
            return []

    def find_layer_by_prefix(self, geo_path: Path, prefix: str) -> str | None:
        # INVARIANTE: las capas se exportan con sufijos dinamicos (fecha, version de
        # formulario, etc.); se buscan por prefijo, no por nombre exacto.
        for layer in self.list_layer_names(geo_path):
            if layer.upper().startswith(prefix):
                return layer
        return None

    def find_monitoreo_layer(self, geo_path: Path) -> str | None:
        return self.find_layer_by_prefix(geo_path, MONITOREO_LAYER_PREFIX)

    def classify_layers(self, geo_path: Path) -> list[tuple[str | None, str]]:
        """Devuelve pares (nombre_de_capa, tabla_destino) para cada capa reconocida."""
        classified: list[tuple[str | None, str]] = []
        for layer in self.list_layer_names(geo_path):
            layer_upper = layer.upper()
            for prefix, table_name in LAYER_PREFIX_TABLE_MAP:
                if layer_upper.startswith(prefix):
                    classified.append((layer, table_name))
                    break

        if not classified:
            # INVARIANTE: retrocompatibilidad — un archivo de una sola capa sin prefijo
            # EUDR_* reconocido (ej. GeoJSON simple de QField) se trata como EUDR_MONITOREO.
            classified.append((None, MONITOREO_TABLE))

        return classified

    def load_layer(self, geo_path: Path, layer_name: str | None) -> gpd.GeoDataFrame:
        # INVARIANTE: fid_as_index=True expone el FID nativo de OGR (GeoPackage/GeoJSON)
        # como indice del GeoDataFrame; se usa como clave de deduplicacion de respaldo
        # cuando no hay suficiente identidad de negocio (parcela/fecha) para el upsert.
        if layer_name is not None:
            gdf = gpd.read_file(geo_path, layer=layer_name, fid_as_index=True)
        else:
            gdf = gpd.read_file(geo_path, fid_as_index=True)

        # INVARIANTE: toda geometría de campo se fuerza a WGS84 antes de insertar.
        if gdf.crs is None or gdf.crs.to_epsg() != 4326:
            gdf = gdf.to_crs(epsg=4326)
        return gdf

    def load_and_reproject(self, geo_path: Path) -> gpd.GeoDataFrame:
        return self.load_layer(geo_path, self.find_monitoreo_layer(geo_path))

    def find_photos(self, extracted_dir: Path) -> list[Path]:
        # INVARIANTE: QField exporta las fotos bajo DCIM/ (a veces anidada varios
        # niveles, ej. DCIM/100QFIELD/...); rglob("*") recorre todo el arbol de
        # directorios sin importar el nombre/mayusculas de la carpeta contenedora,
        # asi que cualquier .jpg/.jpeg/.png dentro de DCIM o dcim se detecta igual.
        return sorted(
            p for p in extracted_dir.rglob("*")
            if p.is_file() and p.suffix.lower() in PHOTO_EXTENSIONS
        )

    def build_storage_path(self, org_id: str, photo_path: Path) -> str:
        return f"{org_id}/{photo_path.name}"

    def resolve_photo_basename(self, foto_name) -> str | None:
        # INVARIANTE: cuando evidencia_foto viene vacio en el GeoPackage, geopandas
        # puede tipar la columna como float64 y devolver NaN (no None ni "") — NaN es
        # truthy en Python, asi que nunca se debe pasar algo no-string a
        # os.path.basename() sin antes descartar float/NaN/otros tipos numericos.
        if not isinstance(foto_name, str):
            return None
        foto_name = foto_name.strip()
        if not foto_name:
            return None
        # INVARIANTE: la comparacion es insensible a mayusculas/minusculas — QField y
        # el sistema de archivos de origen no siempre coinciden en el casing del nombre.
        return os.path.basename(foto_name).lower()

    def compute_deterministic_id(self, *parts) -> str:
        # INVARIANTE: la misma clave natural siempre produce el mismo UUID; esto es lo
        # que permite que un upsert repetido actualice el registro existente en vez de
        # generarle un id nuevo (evita "romper" referencias externas al reprocesar).
        key = "|".join("" if part is None else str(part) for part in parts)
        return str(uuid.uuid5(RYZOS_DEDUP_NAMESPACE, key))

    def resolve_fecha_monitoreo(self, raw_value, now: datetime | None = None) -> str:
        # INVARIANTE: nunca insertar un string invalido ("None"/"NaT"/"") en una columna date.
        # Si el paquete de campo no trae fecha valida, se usa la fecha actual de procesamiento.
        if raw_value is not None:
            try:
                is_missing = pd.isna(raw_value)
            except (TypeError, ValueError):
                is_missing = False
            if not is_missing:
                value_str = str(raw_value).strip()
                if value_str.lower() not in INVALID_DATE_TOKENS:
                    return value_str

        return (now or datetime.now()).strftime("%Y-%m-%d")

    def sanitize_json_value(self, value):
        # INVARIANTE: JSON/Postgres no aceptan NaN/Infinity ni tipos numpy/pandas;
        # todo valor del payload se normaliza a un tipo nativo de Python o None.
        if value is None or isinstance(value, (dict, list)):
            return value

        if isinstance(value, (np.floating, float)):
            value = float(value)
            return None if math.isnan(value) or math.isinf(value) else value

        if isinstance(value, np.integer):
            return int(value)

        if isinstance(value, np.bool_):
            return bool(value)

        try:
            if pd.isna(value):
                return None
        except (TypeError, ValueError):
            pass

        return value

    def resolve_field_with_fallback(self, row, candidates: tuple[str, ...]):
        # INVARIANTE: se recorre la lista de candidatos en orden de prioridad y se usa
        # el primer valor presente y no vacio; nunca el nombre de columna en si.
        for field_name in candidates:
            value = row.get(field_name)
            if value is None:
                continue
            try:
                is_missing = pd.isna(value)
            except (TypeError, ValueError):
                is_missing = False
            if is_missing:
                continue
            if isinstance(value, str) and not value.strip():
                continue
            return value
        return None

    def build_monitoreo_payload(
        self,
        row,
        org_id: str,
        fid=None,
        record_id: str | None = None,
        evidencia_foto=_UNSET,
        now: datetime | None = None,
    ) -> dict:
        geom_json = mapping(row.geometry) if row.geometry else None

        id_parcela_fija = self.resolve_field_with_fallback(row, PARCELA_FIELD_CANDIDATES)
        parcela_id_estricto = self.resolve_field_with_fallback(row, PARCELA_STRICT_CANDIDATES)
        nuevo_productor_nombre = self.resolve_field_with_fallback(row, PRODUCTOR_NOMBRE_CANDIDATES)
        foto_value = (
            self.resolve_field_with_fallback(row, EVIDENCIA_FOTO_CANDIDATES)
            if evidencia_foto is _UNSET
            else evidencia_foto
        )
        fecha_monitoreo = self.resolve_fecha_monitoreo(row.get("fecha_monitoreo"), now=now)

        # INVARIANTE: id_monitoreo se deriva de forma deterministica de la clave natural
        # (organizacion + parcela + fecha) para que un upsert repetido actualice SIEMPRE
        # el mismo registro. Si no hay parcela resuelta, se usa el fid del GeoPackage
        # como respaldo; solo si tampoco hay fid se genera un uuid4 aleatorio.
        if id_parcela_fija is not None:
            id_monitoreo = self.compute_deterministic_id(
                MONITOREO_TABLE, org_id, id_parcela_fija, fecha_monitoreo
            )
        elif fid is not None:
            id_monitoreo = self.compute_deterministic_id(MONITOREO_TABLE, org_id, "fid", fid)
        else:
            id_monitoreo = record_id or str(uuid.uuid4())

        observaciones = row.get("observaciones") or ""
        # INVARIANTE: si la parcela solo se identifico por nombre (sin ID/codigo estricto),
        # se deja constancia en observaciones para que el revisor QC no confunda el valor
        # de ID_Parcela_Fija con un codigo formal.
        if id_parcela_fija is not None and parcela_id_estricto is None:
            nota = f"[Parcela identificada solo por nombre: {id_parcela_fija}]"
            observaciones = f"{observaciones} {nota}".strip()

        payload = {
            "id_monitoreo": id_monitoreo,
            "ID_Organizacion": org_id,
            "ID_Parcela_Fija": id_parcela_fija,
            "ID_Socio": self.resolve_field_with_fallback(row, SOCIO_ID_CANDIDATES),
            "nuevo_productor_nombre": nuevo_productor_nombre,
            "fecha_monitoreo": fecha_monitoreo,
            "tecnico_responsable": row.get("tecnico_responsable", "Tecnico Campo"),
            "precision_gps": row.get("precision_gps"),
            "evidencia_foto": foto_value,
            "cumple_eudr": row.get("cumple_eudr", "SI"),
            "observaciones": observaciones,
            "geom_inspeccion": geom_json,
            "estado_revision": "PENDIENTE",  # INVARIANTE: nunca omitir
            # INVARIANTE: EUDR_MONITOREO NO tiene columna fid (PGRST204 si se envia).
            # fid solo se usa arriba, internamente, como respaldo para derivar
            # id_monitoreo cuando no hay parcela resuelta — nunca como campo del payload.
        }
        return {key: self.sanitize_json_value(value) for key, value in payload.items()}

    def build_uso_suelo_payload(self, row, org_id: str, fid=None) -> dict:
        geom_json = mapping(row.geometry) if row.geometry else None
        payload = {
            "id_parcela": self.resolve_field_with_fallback(row, ("id_parcela",)),
            "tipo_uso": self.resolve_field_with_fallback(row, ("tipo_uso",)),
            "geom": geom_json,
            "ID_Organizacion": org_id,
            "estado_revision": "PENDIENTE",  # INVARIANTE: nunca omitir
            "fid": fid,
        }
        return {key: self.sanitize_json_value(value) for key, value in payload.items()}

    def build_instalaciones_payload(self, row, org_id: str, fid=None, evidencia_foto=_UNSET) -> dict:
        geom_json = mapping(row.geometry) if row.geometry else None
        foto_value = (
            self.resolve_field_with_fallback(row, EVIDENCIA_FOTO_CANDIDATES)
            if evidencia_foto is _UNSET
            else evidencia_foto
        )
        payload = {
            "id_parcela": self.resolve_field_with_fallback(row, ("id_parcela",)),
            "tipo_infra": self.resolve_field_with_fallback(row, ("tipo_infra",)),
            "evidencia_foto": foto_value,
            "geom": geom_json,
            "ID_Organizacion": org_id,
            "estado_revision": "PENDIENTE",  # INVARIANTE: nunca omitir
            "fid": fid,
        }
        return {key: self.sanitize_json_value(value) for key, value in payload.items()}

    def build_payload_for_table(
        self,
        table_name: str,
        row,
        org_id: str,
        fid=None,
        record_id: str | None = None,
        evidencia_foto=_UNSET,
        now: datetime | None = None,
    ) -> dict:
        if table_name == MONITOREO_TABLE:
            return self.build_monitoreo_payload(
                row, org_id, fid=fid, record_id=record_id, evidencia_foto=evidencia_foto, now=now
            )
        if table_name == USO_SUELO_TABLE:
            return self.build_uso_suelo_payload(row, org_id, fid=fid)
        if table_name == INSTALACIONES_TABLE:
            return self.build_instalaciones_payload(row, org_id, fid=fid, evidencia_foto=evidencia_foto)
        raise ValueError(f"Tabla EUDR no reconocida: {table_name}")

    def resolve_upsert_conflict_target(self, table_name: str, payload: dict) -> str:
        # INVARIANTE: el conflict target debe coincidir con una restriccion UNIQUE real
        # en Supabase. EUDR_MONITOREO conflictua sobre su propia Primary Key
        # (id_monitoreo), que compute_deterministic_id() ya deriva de la clave de
        # negocio (organizacion + parcela + fecha, o organizacion + fid de respaldo);
        # como nunca es NULL, esto tambien deduplica correctamente las filas sin
        # parcela resuelta, algo que el conflict target compuesto no lograba (NULL no
        # es igual a NULL para una restriccion UNIQUE). EUDR_MONITOREO no tiene columna
        # fid (PGRST204 si se la nombra), asi que jamas debe usarse como conflict target
        # para esa tabla. Solo EUDR_USO_SUELO / EUDR_INSTALACIONES tienen fid y lo usan
        # junto a la organizacion para identificar la feature de origen del GeoPackage.
        if table_name == MONITOREO_TABLE:
            return "id_monitoreo"
        return "ID_Organizacion,fid"

    def upload_evidence_photo(self, photo_path: Path, storage_path: str) -> str:
        content_type = mimetypes.guess_type(photo_path.name)[0] or "image/jpeg"
        with open(photo_path, "rb") as f:
            self.supabase.storage.from_(EVIDENCIA_BUCKET).upload(
                path=storage_path,
                file=f,
                # INVARIANTE: la ruta de Storage es {org_id}/{filename}, sin carpeta por
                # registro; dos fotos con el mismo nombre de archivo (comun en camaras
                # QField) colisionan en la misma ruta. upsert evita que la segunda falle
                # con 409 Duplicate; la ultima subida gana.
                file_options={"content-type": content_type, "upsert": "true"},
            )
        return storage_path

    def build_archive_destination(
        self, zip_path: Path, org_id: str, timestamp: datetime | None = None
    ) -> Path:
        ts = (timestamp or datetime.now()).strftime("%Y%m%d_%H%M%S")
        new_name = f"PROCESADO_{ts}_{zip_path.name}"
        return self.drive_root / org_id / ARCHIVE_DIRNAME / new_name

    def archive_package(
        self,
        zip_path: Path,
        org_id: str,
        execute_move: bool = True,
        timestamp: datetime | None = None,
    ) -> Path:
        dest_path = self.build_archive_destination(zip_path, org_id, timestamp)
        if execute_move:
            dest_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(zip_path), str(dest_path))
        return dest_path

    def process_layer_rows(
        self, gdf: gpd.GeoDataFrame, table_name: str, org_id: str, photo_map: dict[str, Path]
    ) -> tuple[list[str], list[str]]:
        """Hace upsert de cada fila de una capa en su tabla destino; devuelve (ids, fotos_subidas)."""
        inserted_ids = []
        uploaded_photos = []

        for fid, row in gdf.iterrows():
            record_id = str(uuid.uuid4())

            storage_path = _UNSET
            if table_name in TABLES_WITH_EVIDENCIA_FOTO:
                # INVARIANTE: QField nombra el atributo de evidencia "evidencia_foto"
                # o, en formularios mas simples, solo "foto".
                foto_name = self.resolve_field_with_fallback(row, EVIDENCIA_FOTO_CANDIDATES)
                # INVARIANTE: QField a veces guarda la ruta relativa del adjunto
                # (ej. "DCIM/foto_01.jpg") en vez del nombre de archivo suelto; se
                # compara siempre por os.path.basename().lower() contra photo_map.
                foto_basename = self.resolve_photo_basename(foto_name)
                photo_path = photo_map.get(foto_basename) if foto_basename else None
                storage_path = None
                if photo_path is not None:
                    storage_path = self.build_storage_path(org_id, photo_path)
                    self.upload_evidence_photo(photo_path, storage_path)
                    uploaded_photos.append(storage_path)

            payload = self.build_payload_for_table(
                table_name, row, org_id, fid=fid, record_id=record_id, evidencia_foto=storage_path
            )
            # INVARIANTE: upsert (no insert) por clave de negocio/fid — reprocesar el
            # mismo paquete actualiza los registros existentes en vez de duplicarlos.
            on_conflict = self.resolve_upsert_conflict_target(table_name, payload)
            self.supabase.table(table_name).upsert(payload, on_conflict=on_conflict).execute()
            inserted_ids.append(payload.get("id_monitoreo") or record_id)

        return inserted_ids, uploaded_photos

    def process_package(self, zip_path: Path, execute_move: bool = True) -> dict:
        org_id = self.get_org_id_from_path(zip_path)

        with tempfile.TemporaryDirectory() as tmp:
            extracted_dir = self.extract_package(zip_path, Path(tmp))

            geo_path = self.find_geo_layer(extracted_dir)
            if geo_path is None:
                raise FileNotFoundError(
                    f"No se encontro capa .gpkg/.geojson en el paquete: {zip_path.name}"
                )

            photos = self.find_photos(extracted_dir)
            # INVARIANTE: indexado por nombre base en minusculas para que el
            # emparejamiento con evidencia_foto sea insensible a mayusculas/minusculas.
            photo_map = {p.name.lower(): p for p in photos}

            inserted_ids = []
            uploaded_photos = []
            records_by_table: dict[str, int] = {}

            for layer_name, table_name in self.classify_layers(geo_path):
                gdf = self.load_layer(geo_path, layer_name)
                layer_ids, layer_photos = self.process_layer_rows(
                    gdf, table_name, org_id, photo_map
                )
                inserted_ids.extend(layer_ids)
                uploaded_photos.extend(layer_photos)
                records_by_table[table_name] = records_by_table.get(table_name, 0) + len(layer_ids)

            archive_dest = self.archive_package(zip_path, org_id, execute_move=execute_move)

        return {
            "org_id": org_id,
            "inserted_ids": inserted_ids,
            "uploaded_photos": uploaded_photos,
            "records_by_table": records_by_table,
            "archive_dest": archive_dest,
        }

    def run(self, execute_move: bool = True) -> list[dict]:
        results = []
        for zip_path in self.discover_packages():
            print(f"[ETL-DRIVE] Procesando paquete: {zip_path}")
            result = self.process_package(zip_path, execute_move=execute_move)
            tablas = ", ".join(
                f"{tabla}={cantidad}" for tabla, cantidad in result["records_by_table"].items()
            )
            print(
                f"  -> Org: {result['org_id']} | "
                f"Registros: {len(result['inserted_ids'])} ({tablas}) | "
                f"Fotos: {len(result['uploaded_photos'])} | "
                f"Archivado en: {result['archive_dest']}"
            )
            results.append(result)
        return results


if __name__ == "__main__":
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("[ERROR] Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
        sys.exit(1)

    if len(sys.argv) < 2:
        print("Uso: python etl_drive_to_supabase.py <ruta_RYZOS_CLIENTES> [--dry-run]")
        sys.exit(1)

    dry_run = "--dry-run" in sys.argv
    pipeline = DriveZipETLPipeline(url, key, sys.argv[1])
    results = pipeline.run(execute_move=not dry_run)

    # Línea final machine-readable — el disparador manual desde
    # /dashboard/qc y /dashboard/mapa (lib/driveSyncTrigger.js) la parsea
    # de stdout para mostrar métricas reales en el toast, en vez de
    # scrapear los prints humanos de arriba (que sí siguen sin cambios,
    # para no romper a nadie que lea el log a ojo).
    summary = {
        "packages_processed": len(results),
        "total_records": sum(len(r["inserted_ids"]) for r in results),
        "total_photos": sum(len(r["uploaded_photos"]) for r in results),
        "organizations": sorted({r["org_id"] for r in results}),
    }
    print("RYZOS_ETL_RESULT_JSON:" + json.dumps(summary))
