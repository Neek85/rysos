// Route Handler: disparador MANUAL de la ingesta Google Drive
// (scripts/etl_drive_to_supabase.py) desde el botón "Sincronizar Google
// Drive" en /dashboard/qc y /dashboard/mapa. Ver specs/drive_sync_trigger.md.
//
// runtime = 'nodejs' explícito: child_process.spawn no existe en el
// runtime Edge de Next.js (mismo motivo que app/api/trace/[lot_hash]/pdf/route.js
// usa 'nodejs' para @react-pdf/renderer).
//
// INVARIANTE DE ALCANCE (ver specs/drive_sync_trigger.md): drive_root
// (RYZOS_CLIENTES) es una ruta de filesystem LOCAL — el mount de Google
// Drive Desktop en la máquina de un desarrollador, no una integración real
// con la API de Google Drive. Este endpoint SOLO puede hacer algo útil
// cuando el proceso Node que lo sirve corre en esa misma máquina
// (`npm run dev` local) y `RYZOS_DRIVE_ROOT` apunta a esa carpeta — en
// cualquier despliegue real (Vercel u otro hosting) esa ruta simplemente
// no existe, así que se responde 200 con un mensaje explicativo en vez de
// intentar un spawn que fallaría de todos modos.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { resolveDriveRoot, parseEtlSummary } from '@/lib/driveSyncTrigger'

const SCRIPT_RELATIVE_PATH = path.join('scripts', 'etl_drive_to_supabase.py')

function runPythonEtl(driveRoot) {
  return new Promise((resolve) => {
    const scriptPath = path.join(process.cwd(), SCRIPT_RELATIVE_PATH)
    const pythonBin = process.env.PYTHON_BIN || 'python'

    const child = spawn(pythonBin, [scriptPath, driveRoot], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        // El script Python lee SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY
        // (sin prefijo NEXT_PUBLIC_) — ver CLAUDE.md. .env.local de este
        // proyecto solo define la variante NEXT_PUBLIC_ para el cliente,
        // así que se provee explícitamente el fallback acá.
        SUPABASE_URL: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      },
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (err) => {
      resolve({ code: -1, stdout, stderr: `${stderr}\n${err.message}` })
    })
    child.on('close', (code) => {
      resolve({ code, stdout, stderr })
    })
  })
}

export async function POST() {
  const driveRoot = resolveDriveRoot(process.env)

  if (!driveRoot || !existsSync(driveRoot)) {
    return Response.json(
      {
        available: false,
        message: driveRoot
          ? `La carpeta configurada (RYZOS_DRIVE_ROOT) no existe en este entorno: ${driveRoot}. ` +
            'Este disparador solo funciona en un entorno local con Google Drive Desktop sincronizado.'
          : 'La sincronización manual solo está disponible en desarrollo local, con RYZOS_DRIVE_ROOT ' +
            'configurada en .env.local apuntando a la carpeta RYZOS_CLIENTES sincronizada por Google Drive Desktop.',
      },
      { status: 200 }
    )
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json(
      {
        available: false,
        message: 'Falta SUPABASE_SERVICE_ROLE_KEY en .env.local — el script Python la necesita para escribir en Supabase.',
      },
      { status: 200 }
    )
  }

  const { code, stdout, stderr } = await runPythonEtl(driveRoot)

  if (code !== 0) {
    return Response.json(
      {
        available: true,
        success: false,
        message: 'El script de sincronización terminó con un error.',
        detail: (stderr || stdout).slice(-2000),
      },
      { status: 500 }
    )
  }

  const summary = parseEtlSummary(stdout)
  return Response.json({ available: true, success: true, summary }, { status: 200 })
}
