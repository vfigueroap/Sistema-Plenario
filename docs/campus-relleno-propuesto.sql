-- Relleno OPCIONAL del campus de los integrantes existentes.
--
-- Ejecutar DESPUÉS de lib/db/migrations/fresh/0002_users_campus.sql.
-- No pisa nada: solo completa a quienes todavía no tienen campus registrado.
--
-- REVISAR ANTES DE USAR. Es una propuesta basada en el mapa de unidades del
-- portal. Lo que no figura aquí (por ejemplo PAB, Escaños Indígenas y los
-- centros CEAP, CEET, CEFA, CETHA-DEAV y CEBa) queda sin campus a propósito:
-- se completa a mano desde Integrantes → Editar → «Campus relacionado».

BEGIN;

UPDATE public.users AS u
SET campus = v.campus
FROM (VALUES
  -- Consejerías: campus de cada unidad
  ('FACSO', 'Juan Gómez Millas'),
  ('FYHH', 'Juan Gómez Millas'),
  ('FACIEN', 'Juan Gómez Millas'),
  ('FCEI', 'Juan Gómez Millas'),
  ('F. Artes', 'Juan Gómez Millas'),
  ('FEN', 'Andrés Bello'),
  ('FAU', 'Andrés Bello'),
  ('FAGOB', 'Andrés Bello'),
  ('FCFM', 'Beauchef'),
  ('FACMED', 'Norte'),
  ('FaO', 'Norte'),
  ('FaCQyF', 'Norte'),
  ('FAGRO', 'Sur'),
  ('FAVET', 'Sur'),
  ('FCFCN', 'Sur'),
  ('Derecho', 'Centro'),
  ('Artes Centro', 'Centro'),
  -- Centros de estudiantes: campus de la unidad a la que pertenecen
  ('CEIA', 'Sur'),
  ('CEIREN', 'Sur'),
  ('CEIF', 'Sur'),
  ('VETERA', 'Sur'),
  ('CEO', 'Norte'),
  ('CEFaQ', 'Norte'),
  ('CES', 'Norte'),
  ('CEI', 'Beauchef'),
  ('CEG', 'Andrés Bello'),
  ('CEDIS', 'Andrés Bello'),
  ('CEIIA', 'Andrés Bello'),
  ('CEIC', 'Andrés Bello'),
  ('CECIP', 'Juan Gómez Millas'),
  ('CECSO', 'Juan Gómez Millas'),
  ('CEFH', 'Juan Gómez Millas'),
  ('CEC', 'Juan Gómez Millas'),
  ('CECO', 'Juan Gómez Millas'),
  ('CED', 'Centro')
) AS v(unidad, campus)
WHERE u.campus IS NULL
  AND u.rol = 'miembro'
  AND u.faculty = v.unidad;

-- Cuántas personas quedaron con y sin campus.
SELECT count(*) FILTER (WHERE campus IS NOT NULL) AS con_campus,
       count(*) FILTER (WHERE campus IS NULL) AS sin_campus
FROM public.users
WHERE rol = 'miembro';

COMMIT;
