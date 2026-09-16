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

Vercel no mantiene el servidor Socket.IO entre invocaciones. El build activa el
modo de consultas REST periódicas: refresca consultas visibles cada pocos
segundos y pausa cuando la pestaña queda oculta o sin red. Esta solución evita
infraestructura adicional y es adecuada para el alcance actual; si la carga de
lecturas de plenarios simultáneos supera el pooler, el siguiente paso es usar
Supabase Realtime o un servicio WebSocket persistente.

## Lista previa al tráfico

1. Aplicar y comprobar las migraciones de `docs/supabase.md`.
2. Crear institución/admin y bucket privado.
3. Configurar todas las variables en Vercel.
4. Confirmar que `/api/healthz` responde correctamente.
5. Probar login, creación/apertura/cierre de sesión, QR/asistencia, votación,
   turno de palabra, acta y exportaciones con datos sintéticos.
6. Abrir dos navegadores y confirmar que el polling propaga cambios.
7. Verificar que un origen no autorizado recibe 403 y que las respuestas de API
   usan `Cache-Control: private, no-store`.

El limitador de intentos de login vive en memoria por instancia. Es defensa
local, no un límite distribuido; si el servicio recibe abuso real debe moverse
a un almacén compartido o al firewall de Vercel.
