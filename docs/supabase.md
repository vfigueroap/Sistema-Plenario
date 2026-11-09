# Preparación de Supabase

## Base nueva

En el SQL Editor, ejecutar en orden:

1. `lib/db/migrations/fresh/0000_initial_schema.sql`
2. `lib/db/migrations/fresh/0001_runtime_grants.sql`
3. `lib/db/migrations/fresh/0002_users_campus.sql`
4. `lib/db/migrations/fresh/0003_intervinientes_regulares.sql`
5. `lib/db/migrations/fresh/0004_cambio_clave_obligatorio.sql`
6. `lib/db/migrations/fresh/0005_indice_votos.sql`
7. `lib/db/migrations/fresh/0006_enqueue_speaking.sql`

La optimización de palabras requiere aplicar `0006_enqueue_speaking.sql` antes
de desplegar el código que la usa. En una base existente que ya tenga las
migraciones anteriores, ejecutar solamente ese archivo. Crea una función con
permisos del invocador y conserva RLS, el orden de la cola y las filas existentes.

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

Las lecturas y escrituras de negocio seleccionan `plenario_runtime` y fijan
`app.institution_id` dentro de una transacción. Las lecturas compartidas primero
verifican el acceso y solo abren la transacción de datos cuando la caché necesita
renovarse. Las políticas RLS rechazan filas de otra institución aun
si una consulta olvida el filtro. `institutions` también queda aislada y una
institución inactiva no puede abrir un contexto de aplicación.
