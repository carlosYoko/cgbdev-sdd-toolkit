import { createHash } from 'node:crypto';

export const tiers = ['light', 'standard', 'heavy'];
export const delegatedMarker = '[CGB_SDD_DELEGATED_V1]';
export const roles = ['scout', 'worker', 'reviewer'];
export function validatePolicy(policy) {
  if (policy?.version !== 1) throw new Error('Versión de política no soportada.');
  if (!policy.model || !/^[a-z0-9-]+$/.test(policy.model.provider) || !/^[a-zA-Z0-9._/-]+$/.test(policy.model.id)) throw new Error('Modelo inválido.');
  if (Object.keys(policy.levels ?? {}).sort().join(',') !== [...tiers].sort().join(',') || tiers.some(t => !['low','medium','high'].includes(policy.levels[t]))) throw new Error('Usa low/medium/high: son portables al SDK de SDD 2.42.');
  for (const [key,min,max] of [['maxParallelBatch',1,2],['maxChainSteps',1,3],['maxActiveCalls',1,2],['maxAttemptsPerTask',1,3],['historyLimit',1,1000]]) {
    if (!Number.isInteger(policy[key]) || policy[key] < min || policy[key] > max) throw new Error(`Límite inválido: ${key}`);
  }
  for (const key of ['routeBuiltinAgents','allowProjectAgents','audit']) if (typeof policy[key] !== 'boolean') throw new Error(`Opción inválida: ${key}`);
  return policy;
}
export function roleOf(name, policy) {
  const managed = /^cgb-(scout|worker|reviewer)-(light|standard|heavy)$/.exec(name ?? '');
  if (managed) return { role: managed[1], minimum: managed[2] };
  if (policy.routeBuiltinAgents && roles.includes(name)) return { role:name };
  return null;
}
export function classify(task, role) {
  const text = task.toLowerCase();
  // Conservative risk signals: never downgrade security/destructive work for token savings.
  if (/secur|seguridad|auth|oauth|permission|permis|payment|pago|billing|factur|migraci|migration|arquitect|architect|race condition|deadlock|concurren|data loss|pérdida de datos|production|producción|crypt|cifrad/.test(text)) return { tier:'heavy', reason:'risk-or-architecture' };
  const files = new Set(text.match(/[a-z0-9_./-]+\.(?:tsx?|jsx?|py|go|rs|java|sql|json|ya?ml)\b/g) ?? []);
  if (files.size >= 6 || /multi[- ]?(?:module|service)|transversal|cross[- ]cutting|difícil|complex|complej|replan/.test(text)) return { tier:'heavy', reason:'cross-cutting-complexity' };
  if (role === 'scout' || /^(?:find|locate|list|summari[sz]e|busca|buscar|localiza|lista|resume|resumir)\b/.test(text.trim())) return { tier:'light', reason:'targeted-discovery' };
  return { tier:'standard', reason:'bounded-implementation-or-review' };
}
const maximum = (...values) => tiers[Math.max(...values.map(t => tiers.indexOf(t)))];
export function taskKey(task, role, cwd = '') { return createHash('sha256').update(`${role}\0${cwd}\0${task.trim()}`).digest('hex').slice(0,20); }
export function decide({ task, role, minimum = 'light', previous, cwd }, policy) {
  const classified = classify(task, role);
  let tier = maximum(classified.tier, minimum);
  let reason = classified.reason;
  if (previous?.failed) {
    if (previous.attempts >= policy.maxAttemptsPerTask || previous.tier === 'heavy') throw new Error('Subagente agotado: revisa el fallo y solicita intervención; no se reintenta automáticamente.');
    tier = maximum(tier, tiers[tiers.indexOf(previous.tier)+1]);
    reason = 'escalated-after-failure';
  }
  return { key:taskKey(task,role,cwd), role, tier, effort:policy.levels[tier], agent:`cgb-${role}-${tier}`, attempts:(previous?.failed ? previous.attempts : 0)+1, reason };
}
export function failedResult(event, index = 0) {
  if (event.isError) return true;
  const result = event.details?.results?.[index];
  return !!result && (result.exitCode !== 0 || result.stopReason === 'error' || result.stopReason === 'aborted' || !!result.errorMessage);
}
export function normalizeEffort(payload, model, configuredModel) {
  if (model?.provider !== configuredModel.provider || model?.id !== configuredModel.id || !payload || typeof payload !== 'object') return;
  const allowed = ['low','medium','high','xhigh','max'];
  const effort = payload.reasoning?.effort;
  if (allowed.includes(effort)) return;
  return { ...payload, reasoning:{...payload.reasoning,effort:'low'} };
}
export function generateAgents(policy) {
  const tools = {scout:'read, grep, find, ls',worker:'read, grep, find, ls, bash, edit, write',reviewer:'read, grep, find, ls'};
  const purpose = {
    scout:'Investiga el alcance solicitado y devuelve rutas y rangos relevantes. No modifiques archivos.',
    worker:'Implementa únicamente el cambio delegado y verifica los resultados con pruebas pertinentes. No amplíes el alcance.',
    reviewer:'Revisa corrección, regresiones y riesgos. No modifiques archivos. Prioriza hallazgos verificables, no preferencias de estilo.',
  };
  return Object.fromEntries(roles.flatMap(role => tiers.map(tier => {
    const name=`cgb-${role}-${tier}`;
    return [`${name}.md`,`---\nname: ${name}\ndescription: ${role} con razonamiento ${policy.levels[tier]}; selección por política de recursos\nmodel: ${policy.model.provider}/${policy.model.id}:${policy.levels[tier]}\ntools: ${tools[role]}\n---\n\n${delegatedMarker}\n\n${purpose[role]}\n\nNo lances subagentes, workers, procesos de SDD ni orquestadores adicionales. Si necesitas otro especialista, devuelve un bloqueo al coordinador.\nLee solo el contexto necesario, pero no omitas pruebas ni verificaciones de seguridad por ahorrar tokens.\nNo imprimas credenciales ni datos sensibles. No hagas commit, push ni operaciones destructivas sin autorización explícita.\nDevuelve un informe breve con: conclusión, archivos/rangos afectados, comprobaciones ejecutadas y bloqueos.\nNo vuelques archivos completos ni historiales de herramientas; incluye referencias para ampliar la revisión.\nSi no puedes completar la tarea, indica claramente el fallo; no declares éxito.\n`];
  })));
}
