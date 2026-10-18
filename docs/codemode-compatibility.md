# Codemode: compatibilidad y alcance

## Resultado de la inspección de SDD 2.42.0

- Trae subagent con modos single/parallel/chain.
- Su SDK usa tool_call para bloquear y comparte el objeto input con la ejecución de la herramienta.
- La compatibilidad del enrutamiento se prueba contra el wrapper real, no solo con mocks propios.
- A diferencia del SDK actual de Pi, no se ha encontrado el contrato completo de herramientas necesario para portar codemode directamente.
- No hay una extensión codemode integrada encontrada en los recursos de esta versión.

## Decisión de esta versión

No instalar codemode de Pi normal, no mezclar sus dependencias con las de SDD y no crear un eval sin aislamiento.
El ahorro inicial proviene de razonamiento proporcionado, contexto smart y delegación acotada.
Este archivo no certifica que no exista ningún paquete externo compatible; solo documenta la instalación inspeccionada.

## Siguiente módulo

Antes de integrar una alternativa:
1. Confirmar SDK/proveedor de herramientas y mecanismos de invocación soportados.
2. Elegir un sandbox real, con límites de memoria, tiempo y salida.
3. Respetar validación, permisos, cancelación y eventos de las herramientas.
4. Filtrar resultados sin ocultar errores ni truncamientos.
5. Añadir pruebas de aislamiento y de llamadas paralelas independientes.
6. Comparar tokens/latencia con una tarea representativa antes de prometer ahorro.

No es una función instalada ni activable en la versión 0.2.0 del toolkit.
