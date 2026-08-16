import math
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
MONITOREO_LAYER_PREFIX = "EUDR_MONITOREO"

# INVARIANTE: QField exporta la capa de monitoreo y sus atributos con nombres que
# varian segun la version del formulario de campo; se resuelve por orden de prioridad,
# prefiriendo siempre el nombre canonico de columna de EUDR_MONITOREO.
PARCELA_FIELD_CANDIDATES = ("ID_Parcela_Fija", "parcela_nombre", "ID_Parcela")
SOCIO_FIELD_CANDIDATES = ("ID_Socio", "nuevo_productor_nombre", "nombre_productor", "productor")


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
        return dest_dir

    def find_geo_layer(self, extracted_dir: Path) -> Path | None:
        gpkg_files = sorted(extracted_dir.rglob("*.gpkg"))
        if gpkg_files:
            return gpkg_files[0]
        geojson_files = sorted(extracted_dir.rglob("*.geojson"))
        if geojson_files:
            return geojson_files[0]
        return None

    def find_monitoreo_layer(self, geo_path: Path) -> str | None:
        # INVARIANTE: la capa de monitoreo puede exportarse con sufijos dinamicos
        # (fecha, version de formulario, etc.); se busca por prefijo, no por nombre exacto.
        try:
            layers = fiona.listlayers(str(geo_path))
        except Exception:
            return None

        for layer in layers:
            if layer.upper().startswith(MONITOREO_LAYER_PREFIX):
                return layer
        return None

    def load_and_reproject(self, geo_path: Path) -> gpd.GeoDataFrame:
        layer_name = self.find_monitoreo_layer(geo_path)
        if layer_name is not None:
            gdf = gpd.read_file(geo_path, layer=layer_name)
        else:
            gdf = gpd.read_file(geo_path)

        # INVARIANTE: toda geometría de campo se fuerza a WGS84 antes de insertar.
        if gdf.crs is None or gdf.crs.to_epsg() != 4326:
            gdf = gdf.to_crs(epsg=4326)
        return gdf

    def find_photos(self, extracted_dir: Path) -> list[Path]:
        return sorted(
            p for p in extracted_dir.rglob("*")
            if p.is_file() and p.suffix.lower() in PHOTO_EXTENSIONS
        )

    def build_storage_path(self, org_id: str, id_monitoreo: str, photo_path: Path) -> str:
        return f"{org_id}/{id_monitoreo}/{photo_path.name}"

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

    def build_monitoreo_payload(self, row, org_id: str, now: datetime | None = None) -> dict:
        id_monitoreo = str(uuid.uuid4())
        geom_json = mapping(row.geometry) if row.geometry else None

        payload = {
            "id_monitoreo": id_monitoreo,
            "ID_Organizacion": org_id,
            "ID_Parcela_Fija": self.resolve_field_with_fallback(row, PARCELA_FIELD_CANDIDATES),
            "ID_Socio": self.resolve_field_with_fallback(row, SOCIO_FIELD_CANDIDATES),
            "fecha_monitoreo": self.resolve_fecha_monitoreo(row.get("fecha_monitoreo"), now=now),
            "tecnico_responsable": row.get("tecnico_responsable", "Tecnico Campo"),
            "precision_gps": row.get("precision_gps"),
            "evidencia_foto": row.get("evidencia_foto"),
            "cumple_eudr": row.get("cumple_eudr", "SI"),
            "observaciones": row.get("observaciones", ""),
            "geom_inspeccion": geom_json,
            "estado_revision": "PENDIENTE",  # INVARIANTE: nunca omitir
        }
        return {key: self.sanitize_json_value(value) for key, value in payload.items()}

    def upload_evidence_photo(self, photo_path: Path, storage_path: str) -> str:
        with open(photo_path, "rb") as f:
            self.supabase.storage.from_(EVIDENCIA_BUCKET).upload(
                path=storage_path,
                file=f,
                file_options={"content-type": "image/jpeg"},
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

    def process_package(self, zip_path: Path, execute_move: bool = True) -> dict:
        org_id = self.get_org_id_from_path(zip_path)

        with tempfile.TemporaryDirectory() as tmp:
            extracted_dir = self.extract_package(zip_path, Path(tmp))

            geo_path = self.find_geo_layer(extracted_dir)
            if geo_path is None:
                raise FileNotFoundError(
                    f"No se encontro capa .gpkg/.geojson en el paquete: {zip_path.name}"
                )

            gdf = self.load_and_reproject(geo_path)
            photos = self.find_photos(extracted_dir)
            photos_by_name = {p.name: p for p in photos}

            inserted_ids = []
            uploaded_photos = []

            for _, row in gdf.iterrows():
                payload = self.build_monitoreo_payload(row, org_id)
                self.supabase.table("EUDR_MONITOREO").insert(payload).execute()
                inserted_ids.append(payload["id_monitoreo"])

                foto_name = row.get("evidencia_foto")
                photo_path = photos_by_name.get(foto_name) if foto_name else None
                if photo_path is not None:
                    storage_path = self.build_storage_path(
                        org_id, payload["id_monitoreo"], photo_path
                    )
                    self.upload_evidence_photo(photo_path, storage_path)
                    uploaded_photos.append(storage_path)

            archive_dest = self.archive_package(zip_path, org_id, execute_move=execute_move)

        return {
            "org_id": org_id,
            "inserted_ids": inserted_ids,
            "uploaded_photos": uploaded_photos,
            "archive_dest": archive_dest,
        }

    def run(self, execute_move: bool = True) -> list[dict]:
        results = []
        for zip_path in self.discover_packages():
            print(f"[ETL-DRIVE] Procesando paquete: {zip_path}")
            result = self.process_package(zip_path, execute_move=execute_move)
            print(
                f"  -> Org: {result['org_id']} | "
                f"Registros: {len(result['inserted_ids'])} | "
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
    pipeline.run(execute_move=not dry_run)
