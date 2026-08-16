import os
import re
import sys
import tempfile
import zipfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import geopandas as gpd
from shapely.geometry import Polygon

from scripts.etl_drive_to_supabase import DriveZipETLPipeline, EVIDENCIA_BUCKET

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_BASE_DIR = PROJECT_ROOT / "temp_drive"

ORG_ID = "ORG-COOP-NORTE"
ZIP_NAME = "monitoreo_campo_e2e.zip"
PHOTO_NAME = "foto_campo_01.jpg"
SOURCE_CRS = "EPSG:32718"  # UTM 18S — coordenadas de campo reales antes de reproyectar

ARCHIVED_ZIP_PATTERN = re.compile(rf"^PROCESADO_\d{{8}}_\d{{6}}_{re.escape(ZIP_NAME)}$")


def setup_directories(base_dir: Path) -> tuple[Path, Path]:
    # base_dir representa RYZOS_CLIENTES; cada organizacion tiene su propio INBOX/ARCHIVE.
    inbox_dir = base_dir / ORG_ID / "INBOX"
    archive_dir = base_dir / ORG_ID / "ARCHIVE"
    inbox_dir.mkdir(parents=True, exist_ok=True)
    archive_dir.mkdir(parents=True, exist_ok=True)
    return inbox_dir, archive_dir


def build_e2e_package(inbox_dir: Path) -> Path:
    """Genera monitoreo_campo_e2e.zip con un poligono UTM 18S y una foto en /DCIM/."""
    gdf = gpd.GeoDataFrame(
        {
            "ID_Parcela_Fija": ["PARC-E2E-001"],
            "ID_Socio": ["SOC-E2E-001"],
            "fecha_monitoreo": ["2026-08-16"],
            "tecnico_responsable": ["Tecnico E2E"],
            "precision_gps": [1.8],
            "evidencia_foto": [PHOTO_NAME],
            "cumple_eudr": ["SI"],
            "observaciones": ["Prueba E2E Tarea 7.5"],
        },
        geometry=[
            Polygon(
                [
                    (650000, 9350000),
                    (650200, 9350000),
                    (650200, 9350200),
                    (650000, 9350200),
                ]
            )
        ],
        crs=SOURCE_CRS,
    )

    zip_path = inbox_dir / ZIP_NAME
    with tempfile.TemporaryDirectory() as tmp:
        gpkg_path = Path(tmp) / "inspeccion_e2e.gpkg"
        gdf.to_file(gpkg_path, layer="EUDR_MONITOREO", driver="GPKG")

        with zipfile.ZipFile(zip_path, "w") as zf:
            zf.write(gpkg_path, arcname="inspeccion_e2e.gpkg")
            zf.writestr(f"DCIM/{PHOTO_NAME}", b"fake-jpeg-bytes-e2e")

    return zip_path


def verify_reprojection(zip_path: Path, extract_dir: Path) -> gpd.GeoDataFrame:
    """Reutiliza la extraccion/reproyeccion del pipeline para probar el criterio WGS84."""
    extract_dir.mkdir(parents=True, exist_ok=True)
    probe = object.__new__(DriveZipETLPipeline)
    extracted = probe.extract_package(zip_path, extract_dir)
    geo_path = probe.find_geo_layer(extracted)
    return probe.load_and_reproject(geo_path)


def build_pipeline(
    base_dir: Path, supabase_url: str, supabase_key: str, mock_supabase: MagicMock | None = None
) -> DriveZipETLPipeline:
    if mock_supabase is not None:
        with patch("scripts.etl_drive_to_supabase.create_client", return_value=mock_supabase):
            pipeline = DriveZipETLPipeline(supabase_url, supabase_key, str(base_dir))
    else:
        pipeline = DriveZipETLPipeline(supabase_url, supabase_key, str(base_dir))

    return pipeline


def verify_archive_criterion(archive_org_dir: Path) -> Path:
    matches = [p for p in archive_org_dir.glob("PROCESADO_*.zip") if ARCHIVED_ZIP_PATTERN.match(p.name)]
    if len(matches) != 1:
        raise AssertionError(f"Zip procesado no encontrado (o duplicado) en {archive_org_dir}: {matches}")
    return matches[0]


def verify_photo_criterion(result: dict) -> str:
    if not result["uploaded_photos"]:
        raise AssertionError("No se identificaron fotos para el bucket evidencias_eudr")
    storage_path = result["uploaded_photos"][0]
    if not storage_path.startswith(f"{ORG_ID}/") or not storage_path.endswith(f"/{PHOTO_NAME}"):
        raise AssertionError(f"Ruta de Storage inesperada: {storage_path}")
    return storage_path


def run_e2e(base_dir: Path, mock_supabase: MagicMock | None = None) -> dict:
    """Orquesta el escenario E2E completo y devuelve resultados + evidencias de verificacion."""
    supabase_url = os.getenv("SUPABASE_URL", "https://fake.supabase.co")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "fake-key")

    inbox_dir, archive_dir = setup_directories(base_dir)
    zip_path = build_e2e_package(inbox_dir)

    gdf_reprojected = verify_reprojection(zip_path, base_dir / "_verify_reproj")

    pipeline = build_pipeline(base_dir, supabase_url, supabase_key, mock_supabase=mock_supabase)
    result = pipeline.process_package(zip_path, execute_move=True)

    archived_zip = verify_archive_criterion(archive_dir)
    storage_path = verify_photo_criterion(result)

    if mock_supabase is not None:
        insert_payload = mock_supabase.table.return_value.insert.call_args[0][0]
        estado_revision = insert_payload["estado_revision"]
    else:
        response = (
            pipeline.supabase.table("EUDR_MONITOREO")
            .select("estado_revision")
            .eq("id_monitoreo", result["inserted_ids"][0])
            .execute()
        )
        estado_revision = response.data[0]["estado_revision"]

    return {
        "result": result,
        "archived_zip": archived_zip,
        "storage_path": storage_path,
        "gdf_epsg": gdf_reprojected.crs.to_epsg(),
        "estado_revision": estado_revision,
    }


def main() -> int:
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    live = bool(supabase_url and supabase_key)

    mock_supabase = None
    if not live:
        print(
            "[E2E-DRIVE] AVISO: no se hallaron SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. "
            "Ejecutando en MODO SIMULADO (cliente Supabase mockeado) — no hay ingesta real."
        )
        mock_supabase = MagicMock()
        mock_supabase.table.return_value.insert.return_value.execute.return_value = MagicMock()

    print(f"[E2E-DRIVE] Base dir: {DEFAULT_BASE_DIR}")
    outcome = run_e2e(DEFAULT_BASE_DIR, mock_supabase=mock_supabase)

    print(f"[E2E-DRIVE] Criterio 1 (archivado/renombrado): OK -> {outcome['archived_zip']}")
    print(f"[E2E-DRIVE] Criterio 2 (foto identificada, bucket={EVIDENCIA_BUCKET}): OK -> {outcome['storage_path']}")
    print(
        f"[E2E-DRIVE] Criterio 3 (WGS84 EPSG:{outcome['gdf_epsg']}, "
        f"estado_revision={outcome['estado_revision']}): "
        f"{'OK' if outcome['gdf_epsg'] == 4326 and outcome['estado_revision'] == 'PENDIENTE' else 'FALLO'}"
    )
    print(f"[E2E-DRIVE] Modo: {'REAL (Supabase live)' if live else 'SIMULADO (sin credenciales live)'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
