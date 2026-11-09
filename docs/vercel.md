# Despliegue en Vercel

`vercel.json` compila el frontend Vite y dirige `/api/*` a la función Express
de `api/index.ts`. Las rutas restantes sirven la SPA. El frontend y la API
comparten dominio, por lo que las cookies de sesión funcionan sin CORS cruzado.

## Proyecto

- Framework Preset: **Other**.
- Root Directory: la raíz de este repositorio.
- Node.js: 24.x.
- Instalar con pnpm y el lockfile incluido.
- Build Command y Output Directory: usar los definidos por `vercel.json`.

## Variables obligatorias

| Variable | Propósito |
| --- | --- |
| `DATABASE_URL` | URL del pooler de transacciones de Supabase. |
| `INSTITUTION_ID` | UUID de la institución creada por el bootstrap. |
| `SESSION_SECRET` | Valor largo, aleatorio y estable por entorno. |
| `APP_URL` | Origen HTTPS exacto del despliegue. |
| `SUPABASE_URL` | URL del proyecto Supabase. |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave privada, sólo del servidor. |
| `SUPABASE_STORAGE_BUCKET` | Bucket privado; normalmente `plenario-actas`. |

Variables recomendadas: `NODE_ENV=production`, `BASE_PATH=/`,
`DB_POOL_MAX=5` y `LOG_LEVEL=info`. `ALLOWED_ORIGINS` sólo se necesita para
orígenes adicionales completos. Nunca usar comodines ni prefijo `VITE_` para
secretos.

Preview debe usar una base, bucket, institución, `SESSION_SECRET` y `APP_URL`
separados de producción. Una URL Preview dinámica no se autoriza por comodín;
debe registrarse explícitamente.

## Tiempo real

El build activa consultas REST con un pulso compartido cada 15 segundos. La fase inicial aleatoria reparte los clientes. Solo se actualizan los apartados que cambiaron, con una lectura de seguridad cada 5 a 10 minutos y una comprobaci?n por minuto de las consultas sin versi?n. Las acciones propias mantienen su actualizaci?n inmediata. El pulso se cachea 5 segundos en el CDN, por lo que la visibilidad de una acci?n ajena puede sumar ese tiempo al intervalo.

El panel p?blico conserva su actualizaci?n cada 90 a 100 segundos. Las pesta?as ocultas o sin red dejan de consultar. Al cerrar el pleno, el polling autenticado se pausa. Para detectar una sesi?n nueva se pulsa Actualizar o se vuelve a la pesta?a. Fuera de un pleno, la mensajer?a se consulta al abrirla o actualizar manualmente.

VITE_POLL_INTERVAL_MS permite ampliar el intervalo de 15000 ms al construir el frontend. Los valores menores o inv?lidos vuelven a 15000. El servidor conserva la comprobaci?n de acceso de cada solicitud y la cach? de usuario de 2 segundos. Las respuestas privadas nunca se almacenan en el CDN.

La compilaci?n de producci?n ejecuta scripts/deploy-migrations.mjs antes de publicar. Usa DATABASE_URL del entorno de Vercel, verifica el pooler de transacciones y aplica ?nicamente la funci?n idempotente 0006. No cambia registros. Si falla, la compilaci?n se detiene. Los previews no ejecutan esta migraci?n y requieren su base separada preparada.

En producci?n se reemplaza el registro de cada petici?n por un agregado por ruta cada minuto de actividad. Incluye recuento, errores y latencias, adem?s de CPU del proceso completo. Esta CPU incluye todas las solicitudes concurrentes y no representa CPU individual por ruta ni la factura de Vercel. Los registros son por instancia y pueden perder el ?ltimo intervalo al reciclarse. Los fallos 5xx se registran de inmediato.

## Lista previa al tráfico

1. Aplicar y comprobar las migraciones de `docs/supabase.md`.
2. Crear institución/admin y bucket privado.
3. Configurar todas las variables en Vercel.
4. Confirmar que `/api/healthz` responde correctamente.
5. Probar login, creación/apertura/cierre de sesión, asistencia, votación,
   turno de palabra, acta y exportaciones con datos sintéticos.
6. Abrir dos navegadores y confirmar que el polling propaga cambios.
7. Verificar que un origen no autorizado recibe 403 y que las respuestas de API
   usan `Cache-Control: private, no-store`.

El limitador de intentos de login vive en memoria por instancia. Es defensa
local, no un límite distribuido; si el servicio recibe abuso real debe moverse
a un almacén compartido o al firewall de Vercel.
