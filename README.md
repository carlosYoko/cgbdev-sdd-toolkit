# cgbdev-sdd-toolkit

Configuración de recursos para **SDD**, independiente de [cgbdev-pi-toolkit](https://github.com/carlosYoko/cgbdev-pi-toolkit).

## Qué aporta esta versión

- Enruta el `subagent` integrado: scout, worker y reviewer → agentes cgb con razonamiento según complejidad.
- Selección heurística sin llamadas adicionales a un modelo: **low / medium / high**.
- Nueve agentes generados: tres roles × tres niveles. Modelo inicial: `openai-codex/gpt-6.1-sol`.
- Eleva el nivel ante fallos estructurados en una petición posterior equivalente; no reintenta por su cuenta.
- Bloquea nuevas peticiones equivalentes tras fallar en high o agotar intentos.
- Máximo 2 tareas por lote paralelo, 3 pasos por cadena y 1 llamada a subagentes activa por proceso.
- Scout y reviewer sin herramientas de escritura ni shell.
- Los agentes gestionados no pueden volver a llamar a subagent cuando se detecta su marcador en el prompt.
- Contexto smart, conservando investigación, reevaluación y comprobaciones.
- Normaliza minimal/none a low para el modelo configurado, conservando los valores válidos.
- Diagnóstico `/sdd-toolkit status` y `/sdd-toolkit doctor`.
- Setup con backups y protección frente a agentes locales modificados.
- Registro local limitado a metadatos, sin tareas, respuestas ni rutas de proyecto.

**Codemode no está instalado.** SDD 2.42.0 no incluye el mismo contrato de herramientas que el Pi actual.
Consulta [docs/codemode-compatibility.md](docs/codemode-compatibility.md).
No se ha añadido un eval de JavaScript ni se ha copiado la extensión de Pi a SDD.

## Requisitos y alcance

Node.js >=22.19, SDD instalado y una cuenta/modelo compatibles.
Base de compatibilidad: **sdd-pi 2.42.0**.
Los scripts usan Node y rutas portables; no necesitan symlinks ni Bash.
Las pruebas automatizadas no contactan proveedores ni GitHub.

El toolkit gestiona llamadas a la herramienta nativa `subagent`, **no todas las unidades del auto-mode** ni otros orquestadores.
No activa el router nativo de modelos de SDD ni selecciona proveedores adicionales.
Usar un único modelo con diferentes esfuerzos evita elegir modelos no disponibles en la cuenta.
No hay un porcentaje fijo de ahorro garantizado.
Las métricas USD de modelos configurados sin tarifas fiables no deben usarse como límite de una suscripción de ChatGPT.

## Instalar en Windows o macOS

Desde este repositorio:

```sh
npm ci --ignore-scripts
npm test
node scripts/setup.mjs --dry-run
npm run setup
npm run check
```

Reinicia SDD. Comprueba dentro de SDD:

```text
/sdd-toolkit doctor
/subagent
```

El login se realiza por separado, mediante `/login` dentro de SDD.
El archivo de modelos incluye `oauth-managed` como marcador requerido por el esquema del SDK, **no es una API key**.
Las credenciales OAuth reales se resuelven desde el auth local y nunca se suben.

El setup respeta `SDD_HOME` (por defecto `~/.sdd`) y admite `--home RUTA`.
Registra este repositorio como paquete local, conserva sus filtros existentes y no copia extensiones internas de SDD.
No muevas la carpeta sin actualizar su declaración de paquete.

Para comprobar el SDK instalado sin llamadas a proveedores:

```sh
npm run check:sdk -- --sdd-root /ruta/al/node_modules/sdd-pi
```

También acepta `SDD_PACKAGE_DIR`. Comprueba la carga real de la extensión, los sufijos de razonamiento y el wrapper de herramientas real.
No valida credenciales ni sustituye una prueba funcional después de recargar SDD.

## Política de razonamiento

`config/resource-policy.json` es la fuente de verdad.

| Trabajo | Nivel inicial |
|---|---|
| Exploración/localización dirigida | low |
| Implementación o revisión acotada | medium |
| Seguridad, autenticación, datos, arquitectura o cambios transversales | high |

Los nombres gestionados explícitos pueden elevar el mínimo; nunca lo reducen.
No se usan xhigh/max automáticamente: su soporte en interfaz/CLI varía con la versión antigua del SDK.
El hook de compatibilidad conserva esos valores si ya llegan válidos al proveedor.
Los parches manuales históricos de la instalación de SDD **no están incluidos ni son necesarios para low/medium/high**.

Un fallo observado puede elevar low → medium → high en la siguiente petición equivalente.
Tras fallar en high se necesita intervención o un reset consciente.
Los fallos de autenticación, cuota, modelo o transporte se detienen para diagnóstico, no se arreglan elevando el esfuerzo.
El historial es acotado, vive en memoria y se reinicia al reiniciar la sesión.
`/sdd-toolkit reset` pide confirmación y no relanza trabajo.

El escalado detecta errores estructurados, no interpreta automáticamente si un informe en texto describe una implementación incorrecta.
El agente coordinador debe comprobar pruebas y criterios de aceptación.
No reformules tareas para eludir los límites.

## Qué se modifica en tu equipo

- `~/.sdd/agent/settings.json`: añade este paquete local; no sustituye modelo, proveedor, tema ni otros paquetes.
- `~/.sdd/agent/models.json`: añade el modelo necesario si falta, conservando endpoints/auth/definiciones existentes.
- `~/.sdd/preferences.md`: aplica solo las preferencias compartidas declaradas; conserva otras claves, comentarios y cuerpo.
- `~/.sdd/agent/agents/cgb-*.md`: nueve archivos gestionados, sin sobrescribir agentes nativos ni personalizados.
- `~/.sdd/toolkit-state/managed-agents.json`: hashes para detectar ediciones locales.
- `~/.sdd/toolkit-backups/`: copias locales de archivos reemplazados.

Si editas a mano un agente gestionado, setup se detendrá antes de sobrescribirlo.
Para personalizarlo, usa otro nombre fuera del conjunto cgb o modifica el generador compartido.
El setup valida y planifica todos los cambios antes de escribir; cada archivo se reemplaza atómicamente.
Si el sistema falla a mitad de una escritura múltiple, no hay transacción global: revisa los backups antes de reintentar.

No se toca auth.json, sesiones, skills locales, Pi normal ni node_modules.
Las skills de empresa se mantienen fuera de este repositorio.
Las preferencias de proyecto de SDD pueden prevalecer sobre las globales.
Mantén proveedores y credenciales específicos de cada equipo en local.

## Límites y seguridad

La política enruta scout/worker/reviewer. Los agentes personalizados mantienen sus nombres y configuración.
Para evitar confundir ámbitos, los gestionados usan agentScope user; no mezcles agentes personalizados y gestionados en el mismo lote.
Pon `routeBuiltinAgents: false` si quieres que solo se gestionen los nombres cgb.
Comprueba si ya tenías agentes personales con nombres scout/worker/reviewer antes de usar el enrutamiento.

Los límites son por proceso; varias sesiones independientes no comparten un presupuesto global.
El tamaño máximo del lote es un límite duro sobre el tool, no una modificación del motor interno de SDD.
El bloqueo de recursión no es un sandbox del sistema operativo: no permite confiar en código ajeno ni evita procesos iniciados por otras vías.
Los agentes worker disponen de shell y pueden modificar archivos; revisa resultados y usa aislamiento cuando corresponda.
Por seguridad, se bloquean lotes paralelos con más de un worker gestionado de escritura; usa una cadena. El resto del paralelismo debe ser independiente. No se fuerzan worktrees ni se considera que isolated=true garantice aislamiento: el SDD inspeccionado puede ignorarlo si su modo de aislamiento no está configurado.
No hay límite duro de tokens por subagente ni timeout nuevo en esta versión.
Los informes breves y el contexto acotado son instrucciones, no un truncamiento oculto de los resultados.

Si se bloquea una llamada por permisos, el evento de fin libera la reserva de recursos.
No hay rollback automático de cambios de código realizados por subagentes.

## Registro y privacidad

Con audit activado se escribe en `~/.sdd/toolkit-state/resources-<pid>.jsonl`.
Campos: identificador hash, rol, nivel, razón categórica, estado e intentos.
No se registran tareas, respuestas, nombres de archivos del proyecto ni credenciales.
Hay rotación por proceso a partir de 1 MiB, con una copia previa. No hay retención automática entre procesos.
Es un registro best-effort; no es un historial durable de reintentos ni un medidor exacto del razonamiento interno del proveedor.
Puedes desactivarlo con `audit: false`.

## Sincronizar

```sh
git pull --ff-only
npm ci --ignore-scripts
npm test
npm run setup
```

Revisa cambios antes de ejecutar scripts y reinicia SDD.
La configuración no actualiza SDD; actualízalo por separado y repite check:sdk.
Para desactivar el toolkit, quita su paquete de settings; sus agentes generados permanecen hasta retirarlos manualmente.
No hay migración/borrado automático de archivos locales.

## Licencia

[MIT](LICENSE). Copyright (c) 2026 Carlos Gimenez.
Los componentes de terceros conservan sus propias licencias.
`private: true` evita publicar por accidente en npm; el repositorio de GitHub es público.
