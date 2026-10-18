# cgbdev-sdd-toolkit

Repositorio independiente para la futura configuración reproducible de SDD.

## Estado

Estructura inicial; NO aplica cambios ni importa archivos de ~/.sdd.
No contiene credenciales, sesiones ni copias de la instalación.
La configuración de Pi normal vive en cgbdev-pi-toolkit.

## Próximos pasos

- Inventariar preferencias, extensiones y modelos de SDD sin importar secretos.
- Diseñar un setup para Windows/macOS que conserve ajustes locales.
- Documentar y comprobar compatibilidad de modelos y niveles de razonamiento.
- Sustituir los parches manuales existentes por una solución mantenible, si sigue siendo necesaria.

Los parches que existen actualmente en la instalación local de SDD NO están exportados aquí.
No copiar auth.json ni el directorio ~/.sdd completo a Git.
Las skills corporativas permanecen fuera de este repositorio.

## Licencia

[MIT](LICENSE). Copyright (c) 2026 Carlos Gimenez.
La licencia cubre los archivos propios del repositorio; los componentes de terceros conservan sus licencias.
`private: true` en package.json evita publicar por accidente en npm; no determina la visibilidad en GitHub.
