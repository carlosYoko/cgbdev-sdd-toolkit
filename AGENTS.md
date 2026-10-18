# Mantenimiento del toolkit SDD

Independiente de Pi normal. No importar ~/.sdd completo ni copiar auth.json, sesiones o skills corporativas.
No modificar node_modules ni recursos internos de SDD. Usar extensiones y configuración propias.
SDK de referencia: sdd-pi 2.42.0. No afirmar que codemode está instalado.
Antes de aplicar: npm ci --ignore-scripts, npm test y revisión de dry-run.
Después de aplicar: npm run check y check:sdk contra la instalación de SDD.
No lanzar pruebas de proveedor ni subagentes reales sin autorización del usuario.
Para Git: revisar diff y secretos; añadir rutas explícitas, nunca git add . a ciegas.
No publicar registros, backups, archivos locales ni credenciales.
