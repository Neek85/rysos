import os
import sys
import uuid
from pathlib import Path
from shapely.geometry import mapping
import geopandas as gpd
from supabase import create_client, Client


class QFieldETLPipeline:
    def __init__(self, supabase_url: str, supabase_key: str):
        self.supabase: Client = create_client(supabase_url, supabase_key)

    def process_gpkg_file(self, gpkg_path: str, org_id: str) -> bool:
        print(f"[ETL] Procesando: {gpkg_path}  |  Org: {org_id}")

        try:
            gdf = gpd.read_file(gpkg_path, layer="EUDR_MONITOREO")
        except Exception as e:
            print(f"[ETL ERROR] No se pudo leer la capa 'EUDR_MONITOREO': {e}")
            return False

        # Reproyectar a WGS84 si el CRS difiere
        if gdf.crs is None or gdf.crs.to_epsg() != 4326:
            gdf = gdf.to_crs(epsg=4326)

        inserted = 0
        for _, row in gdf.iterrows():
            id_monitoreo = str(uuid.uuid4())
            geom_json = mapping(row.geometry) if row.geometry else None

            payload = {
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

            self.supabase.table("EUDR_MONITOREO").insert(payload).execute()
            inserted += 1
            print(f"  -> [{inserted}] Insertado {id_monitoreo} — estado: PENDIENTE")

        return True

    def upload_evidence_photo(self, photo_path: str, org_id: str, id_monitoreo: str) -> str | None:
        photo_path = Path(photo_path)
        if not photo_path.exists():
            print(f"[ETL WARN] Foto no encontrada: {photo_path}")
            return None

        storage_key = f"{org_id}/{id_monitoreo}/{photo_path.name}"
        with open(photo_path, "rb") as f:
            self.supabase.storage.from_("evidencias_eudr").upload(
                path=storage_key,
                file=f,
                file_options={"content-type": "image/jpeg"},
            )
        print(f"  -> Foto subida: {storage_key}")
        return storage_key


if __name__ == "__main__":
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("[ERROR] Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
        sys.exit(1)

    if len(sys.argv) < 3:
        print("Uso: python etl_qfield_ingest.py <ruta.gpkg> <ID_Organizacion>")
        sys.exit(1)

    pipeline = QFieldETLPipeline(url, key)
    success = pipeline.process_gpkg_file(sys.argv[1], sys.argv[2])
    sys.exit(0 if success else 1)
