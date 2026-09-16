# Preparación de Supabase

## Base nueva

En el SQL Editor, ejecutar en orden:

1. `lib/db/migrations/fresh/0000_initial_schema.sql`
2. `lib/db/migrations/fresh/0001_runtime_grants.sql`

El primer archivo crea tablas, relaciones, índices, políticas RLS y el rol
`plenario_runtime`. El segundo concede sólo los permisos que necesita la API.
No usar `drizzle push` en producción: no representa completamente las políticas
RLS ni algunas claves foráneas institucionales.

La conexión usada por Vercel debe poder ejecutar `SET LOCAL ROLE
plenario_runtime`. La cuenta `postgres` de Supabase puede hacerlo. Si se crea
otra cuenta de conexión, un administrador debe concederle pertenencia:

```sql
grant plenario_runtime to nombre_de_la_cuenta;
```

Usar en Vercel la URL del pooler de transacciones y limitar cada instancia con
`DB_POOL_MAX=5` (o menos si el plan lo requiere).

## Institución y administrador

Definir temporalmente las variables `BOOTSTRAP_INSTITUTION_*` y
`BOOTSTRAP_ADMIN_*` descritas en `.env.example`, ejecutar:

```sh
pnpm --filter @workspace/scripts seed
```

El comando es idempotente: no reemplaza una contraseña o rol ya existentes.
Después se pueden retirar de la terminal esas variables de bootstrap; Vercel no
las necesita.

## Actas

Crear un bucket privado llamado `plenario-actas` (o cambiar
`SUPABASE_STORAGE_BUCKET`). La API usa `SUPABASE_SERVICE_ROLE_KEY` sólo en el
servidor. No crear una variable `VITE_` con esa clave ni volver público el
bucket. Los objetos se guardan bajo el prefijo UUID de la institución.

## Aislamiento

La API abre una transacción por solicitud, selecciona `plenario_runtime` y fija
`app.institution_id`. Las políticas RLS rechazan filas de otra institución aun
si una consulta olvida el filtro. `institutions` también queda aislada y una
institución inactiva no puede abrir un contexto de aplicación.
