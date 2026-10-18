import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePolicy, roleOf, decide, taskKey, failedResult, normalizeEffort, delegatedMarker } from '../scripts/resource-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function createResourceRouter(pi, policy, { agentDir, audit = async () => {} }) {
  validatePolicy(policy);
  const history = new Map();
  const pending = new Map();
  let delegated = false;
  const remember = (key,value) => {
    history.delete(key); history.set(key,value);
    while (history.size > policy.historyLimit) history.delete(history.keys().next().value);
  };
  pi.on('before_agent_start', event => { delegated = event.systemPrompt.includes(delegatedMarker); });
  pi.on('before_provider_request', event => normalizeEffort(event.payload,event.model,policy.model));
  pi.on('tool_call', async (event,ctx) => {
    if (event.toolName !== 'subagent') return;
    if (delegated) return {block:true,reason:'Los agentes gestionados no pueden delegar otra vez. Devuelve el bloqueo al coordinador.'};
    if (pending.size >= policy.maxActiveCalls) return {block:true,reason:'Límite de llamadas a subagentes activas. Espera a que finalice la anterior.'};
    const input=event.input;
    const modes=[!!input.agent,Array.isArray(input.tasks)&&input.tasks.length>0,Array.isArray(input.chain)&&input.chain.length>0];
    if (modes.filter(Boolean).length !== 1) return {block:true,reason:'Usa exactamente un modo de subagente: single, parallel o chain.'};
    const items=modes[1] ? input.tasks : modes[2] ? input.chain : [input];
    if (modes[1] && items.length > policy.maxParallelBatch) return {block:true,reason:`Máximo ${policy.maxParallelBatch} tareas por lote paralelo; divide el trabajo independiente.`};
    if (modes[2] && items.length > policy.maxChainSteps) return {block:true,reason:`Máximo ${policy.maxChainSteps} pasos de cadena; revisa el resultado antes de continuar.`};
    if (modes[1] && items.filter(item=>roleOf(item.agent,policy)?.role==='worker').length>1) return {block:true,reason:'Solo se permite un worker de escritura por lote. Usa una cadena o verifica aislamiento fuera de esta política.'};
    const planned=[];
    const used=new Set();
    try {
      for (let i=0;i<items.length;i++) {
        const item=items[i];
        const selected=roleOf(item.agent,policy);
        if (!selected) continue; // Custom agents retain their configuration and identity.
        if (!policy.allowProjectAgents && input.agentScope === 'project') throw new Error('Los agentes gestionados son de ámbito user; no se reemplazan agentes del proyecto.');
        if (typeof item.task !== 'string' || !item.task.trim()) throw new Error('La tarea no puede estar vacía.');
        if (item.task.length > 20000) throw new Error('La tarea incluye demasiado contexto; referencia archivos en vez de pegarlos completos.');
        const key=taskKey(item.task,selected.role,item.cwd??input.cwd??ctx.cwd);
        if (used.has(key) || [...pending.values()].some(p=>p.some(x=>x.key===key))) throw new Error('Tarea duplicada en ejecución; no se lanza otro agente para el mismo trabajo.');
        used.add(key);
        const decision=decide({task:item.task,role:selected.role,minimum:selected.minimum,cwd:item.cwd??input.cwd??ctx.cwd,previous:history.get(key)},policy);
        await fs.access(path.join(agentDir,'agents',`${decision.agent}.md`));
        if (!ctx.modelRegistry.find(policy.model.provider,policy.model.id)) throw new Error('Modelo configurado no registrado; ejecuta npm run setup y comprueba el login.');
        planned.push({...decision,index:i,item});
      }
      if (planned.length && !policy.allowProjectAgents && items.some(item=>!roleOf(item.agent,policy))) throw new Error('Separa agentes gestionados y personalizados en llamadas distintas para conservar sus ámbitos.');
      // Reserve after asynchronous checks; a sibling hook may have reserved meanwhile.
      if (pending.size >= policy.maxActiveCalls) throw new Error('Otra llamada a subagentes está activa; espera su resultado.');
      for (const decision of planned) if ([...pending.values()].some(p=>p.some(x=>x.key===decision.key))) throw new Error('La misma tarea ya está activa.');
      pending.set(event.toolCallId,planned);
      for (const decision of planned) decision.item.agent=decision.agent;
      if (planned.length && !policy.allowProjectAgents) input.agentScope='user';
      for (const decision of planned) {
        const {item,index,...record}=decision;
        await audit({type:'dispatch',...record});
        ctx.ui.notify(`Recursos: ${decision.role} → ${decision.effort} (${decision.reason})`, 'info');
      }
    } catch (error) {
      pending.delete(event.toolCallId);
      return {block:true,reason:error.code==='ENOENT' ? 'Faltan agentes gestionados; ejecuta npm run setup del toolkit de SDD.' : error.message};
    }
  });
  const finish = async event => {
    if (event.toolName !== 'subagent') return;
    const decisions=pending.get(event.toolCallId);
    if (!decisions) return;
    pending.delete(event.toolCallId);
    for (const decision of decisions) {
      // A chain can stop early. Never label unexecuted steps as completed.
      const result=event.details?.results?.[decision.index];
      if (!result && !event.isError) continue;
      const failed=failedResult(event,decision.index);
      const permanent=!!result && /unauthorized|forbidden|invalid.*key|not supported|quota|usage.limit|billing|rate.limit|fetch failed|network|ECONN|ETIMEDOUT|timeout/i.test(result.errorMessage??result.stderr??'');
      remember(decision.key,{tier:permanent?'heavy':decision.tier,attempts:decision.attempts,failed});
      await audit({type:'result',key:decision.key,role:decision.role,tier:decision.tier,effort:decision.effort,failed,permanent,attempts:decision.attempts});
    }
  };
  pi.on('tool_result', finish);
  // A later permission hook can block before the tool wrapper emits tool_result.
  pi.on('tool_execution_end', async event => {
    if (event.isError && pending.has(event.toolCallId)) await finish({...event,isError:true});
  });
  const resetSession=()=>{pending.clear();history.clear();delegated=false;};
  pi.on('session_switch',resetSession);
  pi.on('session_shutdown',resetSession);
  pi.registerCommand('sdd-toolkit',{
    description:'Política de recursos: status, doctor y reset',
    handler:async(args,ctx)=>{
      const command=args.trim()||'status';
      if (command==='reset') {
        if (pending.size) {ctx.ui.notify('Espera a que finalicen los agentes.', 'warning');return;}
        if (!ctx.hasUI || !await ctx.ui.confirm('Reiniciar historial de recursos','Se olvidarán fallos y escalados de esta sesión. No se reintenta ninguna tarea. ¿Continuar?')) return;
        history.clear();ctx.ui.notify('Historial de escalado reiniciado.', 'info');return;
      }
      if (!['status','doctor'].includes(command)) {ctx.ui.notify('/sdd-toolkit status | doctor | reset', 'info');return;}
      const loaded=!!ctx.modelRegistry.find(policy.model.provider,policy.model.id);
      let missing=0;
      if (command==='doctor') for(const role of ['scout','worker','reviewer']) for(const tier of ['light','standard','heavy']) {
        try {await fs.access(path.join(agentDir,'agents',`cgb-${role}-${tier}.md`));}catch{missing++;}
      }
      const codemode=typeof pi.getAllTools==='function' && pi.getAllTools().some(tool=>tool.name==='codemode');
      ctx.ui.notify(`Toolkit SDD: ${root}\nModelo: ${policy.model.provider}/${policy.model.id} (${loaded?'registrado':'NO registrado'})\nRazona: low / medium / high, elegidos por complejidad y riesgo.\nLote paralelo: ${policy.maxParallelBatch}; llamadas activas: ${pending.size}/${policy.maxActiveCalls}.\nHistorial de esta sesión: ${history.size}; proceso delegado: ${delegated?'sí':'no'}.\n${command==='doctor'?`Agentes ausentes: ${missing}. El login y una llamada real se verifican por separado.\n`:''}Codemode: ${codemode?'detectado externamente; no gestionado por este toolkit':'no instalado; SDK 2.42 sin compatibilidad nativa verificada'}.`,loaded&&!missing?'info':'warning');
    },
  });
}
export default async function resourceRouter(pi) {
  const policy=validatePolicy(JSON.parse(await fs.readFile(path.join(root,'config/resource-policy.json'),'utf8')));
  const home=process.env.SDD_HOME||path.join(os.homedir(),'.sdd');
  const agentDir=path.join(home,'agent');
  let warned=false;
  const audit=async record=>{
    if(!policy.audit)return;
    try {
      const dir=path.join(home,'toolkit-state');await fs.mkdir(dir,{recursive:true});
      const file=path.join(dir,`resources-${process.pid}.jsonl`);
      try {if((await fs.stat(file)).size>1024*1024){await fs.rm(file+'.1',{force:true});await fs.rename(file,file+'.1');}}catch(e){if(e.code!=='ENOENT')throw e;}
      await fs.appendFile(file,JSON.stringify({time:new Date().toISOString(),...record})+'\n',{mode:0o600});
    }catch{if(!warned){warned=true;/* Auditing is best-effort; never leak filesystem contents. */}}
  };
  createResourceRouter(pi,policy,{agentDir,audit});
}
