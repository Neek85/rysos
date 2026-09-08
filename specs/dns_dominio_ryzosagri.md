# SPEC: Configuración DNS y Resolución de Dominio ryzosagri.com en Vercel

## 1. Objetivo
Documentar, diseñar y definir la especificación técnica para la configuración del dominio de producción `ryzosagri.com` apuntando a la infraestructura de Vercel. Esto garantiza la resolución correcta de la aplicación web y la emisión de certificados SSL/TLS automáticos.

## 2. Parámetros Técnicos del Dominio
El direccionamiento y la resolución del tráfico hacia la aplicación Next.js alojada en Vercel se rigen por las siguientes especificaciones DNS estándar para Vercel:

### 2.1 Dominio Principal (Apex Domain - ryzosagri.com)
* **Tipo de Registro:** A
* **Nombre / Host:** `@` o vacío
* **Valor / Destino:** `76.76.21.21` (Dirección IP Anycast de Vercel)
* **TTL:** Automático o 3600 (1 hora)
* **Descripción:** Dirige el tráfico que accede directamente a `ryzosagri.com` hacia la red global edge de Vercel.

### 2.2 Subdominio Principal (www.ryzosagri.com)
* **Tipo de Registro:** CNAME
* **Nombre / Host:** `www`
* **Valor / Destino:** `cname.vercel-dns.com.` (con punto al final si el registrador lo requiere)
* **TTL:** Automático o 3600 (1 hora)
* **Descripción:** Redirecciona el tráfico de `www.ryzosagri.com` a los servidores de Vercel. Se configurará en el panel de Vercel para redirigir automáticamente (Redirect) al dominio Apex `ryzosagri.com` para evitar problemas de SEO por contenido duplicado.

### 2.3 Configuración de Proveedor DNS (Cloudflare / Otros Registradores)
Si el dominio es gestionado mediante Cloudflare:
* **Estado de Proxy (Proxy Status):** Se debe establecer en **DNS Only (Bypass / Color Gris)** temporalmente para la verificación inicial y la emisión del certificado SSL de Vercel (Let's Encrypt).
* **Modo de SSL/TLS (si está en Cloudflare):** Debe configurarse en **Full (Completo)** o **Full (Strict)** una vez activado, evitando el modo "Flexible" que puede provocar bucles de redirección infinita (HTTP 310) debido a la redirección forzada a HTTPS de Vercel.

## 3. Emisión de Certificado SSL/TLS
* **Certificado:** Vercel genera de manera automática y gratuita certificados gestionados mediante Let's Encrypt o Amazon Trust Services.
* **Proceso de Validación:** Se completa de manera autónoma una vez que Vercel detecta la propagación de los registros DNS especificados (A y CNAME).
* **Renovación:** Vercel se encarga de la renovación automática del certificado 30 días antes de su vencimiento, sin necesidad de intervención manual o configuración externa.

## 4. Criterios de Aceptación
- [ ] La especificación técnica está documentada con los registros DNS correctos para `ryzosagri.com`.
- [ ] El plan de ejecución detalla paso a paso las acciones manuales requeridas en el panel del registrador y en el dashboard de Vercel.
- [ ] El frontend compila de manera exitosa localmente (`npm run build`) y pasa las verificaciones de linter (`npm run lint`), asegurando que no existan inconsistencias de código o de configuración.
- [ ] Se verifica que `process.env.NEXT_PUBLIC_APP_URL` esté correctamente definido con un fallback a `https://ryzosagri.com` en el código productivo de la aplicación.

## 5. Pasos Manuales Fuera del Repositorio (Dashboard de Vercel e Infraestructura)
Estas acciones deben ejecutarse por el administrador de la infraestructura dado que requieren credenciales de acceso privadas:

### Paso A: Configuración en el Registrador de Dominio / DNS
1. Iniciar sesión en el portal de gestión de DNS (Cloudflare, GoDaddy o similar) donde esté registrado `ryzosagri.com`.
2. Crear o actualizar el registro A para el host `@` apuntando a `76.76.21.21`.
3. Crear o actualizar el registro CNAME para el host `www` apuntando a `cname.vercel-dns.com`.
4. Si se utiliza Cloudflare, asegurarse de que el proxy de Cloudflare esté configurado como **DNS Only** para agilizar la verificación inicial del certificado SSL.

### Paso B: Configuración en el Portal de Vercel
1. Ingresar a `vercel.com` e iniciar sesión.
2. Navegar al proyecto `rysos`.
3. Ir a **Settings** -> **Domains**.
4. En el campo de agregar dominio, ingresar `ryzosagri.com` y hacer clic en **Add**.
5. Vercel sugerirá añadir también `www.ryzosagri.com` y configurar una redirección automática. Seleccionar la opción de redirección de `www.ryzosagri.com` a `ryzosagri.com` (dominio canonical principal).
6. Esperar a que el estado de validación DNS cambie a **Valid** (puede tomar desde unos minutos hasta 24 horas según la propagación del DNS).
7. Verificar que la sección "SSL Certificate" se complete de forma exitosa mostrando "Generated".
