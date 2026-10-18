---
name: resource-aware-delegation
description: Delegar trabajo en SDD con razonamiento según complejidad, contexto acotado y escalado controlado, sin omitir verificaciones.
---

# Delegación eficiente en SDD

No delegues una consulta trivial que puedas resolver directamente con una herramienta.
Para trabajo independiente y acotado usa la herramienta subagent integrada.
El toolkit enruta los nombres scout, worker y reviewer a agentes cgb con low/medium/high.
Los agentes personalizados no se reemplazan. Usa llamadas separadas para agentes personalizados y gestionados.

- Scout: localizar contexto y devolver rutas/rangos, sin escritura.
- Worker: implementar y comprobar el cambio.
- Reviewer: revisar hallazgos, sin escritura ni shell.
- El riesgo de seguridad, datos o arquitectura debe elevar el razonamiento aunque la tarea sea corta.
- No uses max de forma automática ni introduzcas proveedores o modelos no verificados.
- No reenvíes el historial completo: proporciona objetivo, alcance, archivos de referencia y criterios verificables.
- No pegues secretos ni datos personales/corporativos en instrucciones o salidas.
- No paralelices escrituras sobre los mismos archivos. El toolkit permite como máximo un worker gestionado de escritura por lote paralelo; usa una cadena para varios workers. isolated=true por sí solo no demuestra que el SDD instalado haya activado worktrees.
- Como máximo dos tareas por lote paralelo y tres pasos por cadena. Los límites son por proceso/sesión, no globales entre todas las sesiones.
- Tras un fallo, revisa primero la causa: no vuelvas a lanzar el mismo trabajo a ciegas.
- Una nueva petición equivalente puede elevar low → medium → high; no existe reintento automático del toolkit.
- Tras fallar en high, detente y explica el bloqueo. No reformules la tarea para eludir el límite.
- Los fallos de login, cuota, modelo incompatible o red no se arreglan con más razonamiento; diagnostícalos.
- No permitas que un subagente vuelva a delegar. No lances procesos SDD adicionales mediante bash.
- Los agentes pueden informar fallos semánticos en texto sin producir un error de proceso. Revisa siempre pruebas y resultados; el escalado automático solo observa fallos estructurados.
- Mantén investigación, pruebas y revisión de seguridad. Ahorrar contexto no equivale a saltarse esas fases.
- Devuelve al usuario conclusión, comprobaciones y bloqueos; no prometas porcentajes fijos de ahorro.

Diagnóstico del usuario: /sdd-toolkit doctor.
La configuración del toolkit está en su repositorio; las decisiones locales no incluyen tareas ni respuestas y viven fuera de Git.
Codemode no forma parte de esta versión del toolkit: no inventes esa herramienta ni prometas que está instalada.
