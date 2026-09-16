# Sistema Plenario

Aplicación web para administrar plenarios: integrantes, asistencia por QR,
tabla de sesión, turnos de palabra, votaciones ponderadas, resultados,
mensajería, actas PDF e historial exportable.

## Arquitectura

- React + Vite en `artifacts/fech-plenario`.
- Express + TypeScript en `artifacts/api-server` y entrada serverless en `api`.
- PostgreSQL con Drizzle y aislamiento institucional mediante RLS en `lib/db`.
- Supabase para PostgreSQL y actas en un bucket privado.
- Vercel para frontend y API bajo el mismo dominio.

Cada despliegue atiende una sola institución, indicada por `INSTITUTION_ID`.
Varias instituciones pueden compartir la misma base: todas las tablas de
negocio incluyen `institution_id` y PostgreSQL aplica el límite mediante RLS.

## Desarrollo

Requisitos: Node.js 24, pnpm 11 y PostgreSQL 17.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
```

La API requiere `DATABASE_URL`, `INSTITUTION_ID` y `SESSION_SECRET`. Copiar las
variables necesarias desde `.env.example`. Para desarrollo, ejecutar API y
frontend en terminales distintas:

```sh
pnpm --filter @workspace/api-server dev
pnpm --filter @workspace/fech-plenario dev
```

Las pruebas de integración nunca usan `DATABASE_URL`: exigen una base local
dedicada cuyo nombre termine en `_test` mediante `TEST_DATABASE_URL`.

```sh
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/fech-plenario test
```

## Instalación

1. Aplicar, en orden, los SQL de `lib/db/migrations/fresh` a un proyecto nuevo
   de Supabase.
2. Crear un bucket privado `plenario-actas`.
3. Ejecutar una vez el bootstrap documentado en `.env.example`:
   `pnpm --filter @workspace/scripts seed`.
4. Configurar las variables de Vercel según `docs/vercel.md` y desplegar.

Para migrar una base heredada, usar `lib/db/migrations/0001_institution_foundation.sql`
en una copia verificada antes de producción; no combinarlo con las migraciones
de instalación limpia.

## Garantías relevantes

- Las contraseñas sólo se almacenan como hashes bcrypt.
- Los resultados cerrados conservan un snapshot del electorado, asistencia y
  votos; cambios o bajas posteriores no reescriben el historial.
- Una votación cerrada o una sesión iniciada/con historial no se puede borrar.
- Las actas son privadas y se sirven a través de la API después de autorizar la
  institución y el estado de la sesión.
- En Vercel se usa actualización REST periódica; Socket.IO queda disponible
  para ejecución Node persistente local.

Consulta `docs/publicacion-segura.md` antes de publicar y `docs/vercel.md` para
las limitaciones operativas y la verificación del despliegue.
