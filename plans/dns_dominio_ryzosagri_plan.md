# PLAN: Configuración DNS y Vinculación del Dominio ryzosagri.com

Este documento detalla los pasos para documentar, configurar y validar la delegación del dominio `ryzosagri.com` hacia la plataforma de despliegue Vercel.

## 1. Fase de Documentación y Diseño
- [x] Crear el documento de especificación técnica `specs/dns_dominio_ryzosagri.md` describiendo la asignación de registros A, CNAME, soporte de SSL, y detalles técnicos para integraciones con proxy DNS (ej. Cloudflare).
- [x] Crear este plan de ejecución en `plans/dns_dominio_ryzosagri_plan.md`.

## 2. Fase de Validación de Repositorio Local (Pre-Despliegue)
- [ ] Ejecutar la validación del linter en local para garantizar la higiene de código y que no existan errores sintácticos o de tipado.
  * **Comando:** `npm run lint`
- [ ] Ejecutar el build de producción Next.js de manera local para asegurar que no existan variables faltantes obligatorias durante la compilación o dependencias rotas que puedan tumbar el build en Vercel.
  * **Comando:** `npm run build`
- [ ] Validar que no existan advertencias ni dependencias mal resueltas en los archivos estáticos generados.

## 3. Fase de Configuración de DNS e Infraestructura (Fuera de Alcance del CLI - Manual)
- [ ] Acceder al registrador de dominio o panel DNS (Cloudflare, etc.) de `ryzosagri.com`.
- [ ] Configurar el registro Apex (A) apuntando a la IP global de Vercel `76.76.21.21`.
- [ ] Configurar el subdominio de respaldo (CNAME) `www.ryzosagri.com` apuntando a `cname.vercel-dns.com.`.
- [ ] Añadir ambos dominios en el dashboard de configuración de Vercel (`Settings` -> `Domains`).
- [ ] Configurar redirección automática de `www.ryzosagri.com` hacia `ryzosagri.com` para unificar el tráfico e indexación SEO.
- [ ] Monitorear la emisión del certificado SSL automática de Vercel y propagación global de DNS mediante herramientas externas como `dig` o DNS checkers en línea.

## 4. Fase de Registro y Cierre
- [ ] Actualizar el archivo `docs/ESTADO_PROYECTO.md` agregando la tarea de configuración DNS y dominio `ryzosagri.com` como completada a nivel de repositorio y lista para ejecución en infraestructura.
- [ ] Realizar un commit siguiendo el estándar Conventional Commits: `docs(infra): agregar spec y plan para configuracion DNS ryzosagri.com`.
- [ ] Realizar push a la rama `staging`.

## 5. Plan de Mitigación y Reversión
En caso de que ocurra algún inconveniente con el tráfico actual o fallas en la emisión del certificado SSL, los pasos de reversión son:
1. **Reversión de DNS:** Restablecer los registros DNS previos (A o CNAME) en el registrador de dominio para volver al estado anterior o apuntar a una página de mantenimiento temporal.
2. **Desvinculación en Vercel:** Retirar el dominio `ryzosagri.com` en la sección `Settings` -> `Domains` del panel de Vercel para evitar conflictos de resolución en despliegues futuros.
3. **Revisión del proxy SSL:** Si Cloudflare produce un bucle de redirecciones infinita, desactivar inmediatamente la opción "Flexible SSL" y cambiarla a "Full" o "DNS Only" (Bypass) hasta resolver la emisión en Vercel.
