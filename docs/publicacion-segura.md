# Publicación segura

Este repositorio debe publicarse como un historial nuevo. El historial privado
anterior contiene configuración, credenciales y datos personales heredados;
no se debe empujar, fusionar ni importar al repositorio público.

## Rutas excluidas

`.gitignore` excluye `.replit`, `replit.md`, `attached_assets`, la instalación
antigua para Replit, maquetas desechables, notas internas y documentación de
diagnóstico superada. También excluye `.env*` salvo `.env.example`, dependencias,
builds, cachés y coberturas.

Antes del primer commit se debe verificar la lista realmente staged, no sólo
confiar en `.gitignore`, y buscar secretos, credenciales y datos personales en
todos los archivos seleccionados.

## Credenciales

- Rotar cualquier `SESSION_SECRET` que haya sido usado en el sistema legado.
- No reutilizar contraseñas legacy ni importar `plain_password`.
- Mantener `SUPABASE_SERVICE_ROLE_KEY`, URLs con contraseña y secretos de sesión
  sólo en variables privadas de Vercel/terminal.
- `.env.example` contiene únicamente marcadores de posición.

El bootstrap crea sólo una institución y una cuenta administradora con hash
bcrypt. No incluye nóminas ni contraseñas predeterminadas. Sus variables se
retiran después de ejecutarlo.

## Comprobación final

1. Confirmar que el commit inicial no contiene archivos ignorados.
2. Ejecutar una búsqueda de patrones de secretos y revisar binarios incluidos.
3. Ejecutar typecheck, pruebas y build desde el snapshot que se publicará.
4. Confirmar que el remoto objetivo es el repositorio vacío correcto.
5. Empujar únicamente la rama nueva; nunca usar `--force` sobre un repositorio
   con trabajo ajeno.

Las credenciales reales de Supabase y Vercel se configuran después del push y
no forman parte de Git.
