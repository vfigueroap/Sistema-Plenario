-- Campus del integrante.
--
-- Permite registrar, para cada integrante, el campus al que pertenece su unidad.
-- Así las consejerías y los centros de estudiantes de un mismo campus quedan
-- relacionados en el portal, sin depender de una tabla fija en el código.
--
-- Es opcional y no destructivo: la columna nueva admite NULL, y mientras esté
-- vacía el portal usa el mapa de respaldo por unidad. Se puede aplicar sobre una
-- base en uso sin interrumpir el servicio. Los permisos de tabla de
-- 0001_runtime_grants.sql ya cubren la columna nueva.

BEGIN;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS campus text;

COMMIT;
