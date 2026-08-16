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
import geopandas as gpd
from supabase import create_client, Client

EVIDENCIA_BUCKET = "evidencias_eudr"
PHOTO_EXTENSIONS = {".jpg", ".jpeg", ".png"}
ARCHIVE_FILENAME_PATTERN = re.compile(r"^PROCESADO_\d{8}_\d{6}_.+\.zip$")
INBOX_DIRNAME = "INBOX"
ARCHIVE_DIRNAME = "ARCHIVE"


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

    def load_and_reproject(self, geo_path: Path) -> gpd.GeoDataFrame:
        try:
            gdf = gpd.read_file(geo_path, layer="EUDR_MONITOREO")
        except Exception:
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

    def build_monitoreo_payload(self, row, org_id: str) -> dict:
        id_monitoreo = str(uuid.uuid4())
        geom_json = mapping(row.geometry) if row.geometry else None

        return {
            "id_monitoreo": id_monitoreo,
            "ID_Organizacion": org_id,
            "ID_Parcela_Fija": row.get("ID_Parcela_Fija"),
            "ID_Socio": row.get("ID_Socio"),
            "fecha_monitoreo": str(row.get("fecha_monitoreo")),
            "tecnico_responsable": row.get("tecnico_responsable", "Tecnico Campo"),
            "precision_gps": float(row.get("precision_gps") or 0.0),
            "evidencia_foto": row.get("evidencia_foto"),
            "cumple_eudr": row.get("cumple_eudr", "SI"),
            "observaciones": row.get("observaciones", ""),
            "geom_inspeccion": geom_json,
            "estado_revision": "PENDIENTE",  # INVARIANTE: nunca omitir
        }

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
