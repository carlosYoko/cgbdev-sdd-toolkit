import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validatePolicy, classify, decide, taskKey, generateAgents, normalizeEffort, failedResult, delegatedMarker } from '../scripts/resource-policy.mjs';
import { createResourceRouter } from '../extensions/resource-router.js';
import { setup, root, mergePreferences, mergeModels } from '../scripts/setup.mjs';
const policy=JSON.parse(await fs.readFile(new URL('../config/resource-policy.json',import.meta.url),'utf8'));

test('política válida, solo niveles portables y límites acotados',()=>{
  assert.equal(validatePolicy(policy),policy);
  assert.throws(()=>validatePolicy({...policy,maxParallelBatch:10}));
  assert.throws(()=>validatePolicy({...policy,levels:{light:'minimal',standard:'medium',heavy:'max'}}));
});
test('clasifica descubrimiento, implementación y riesgo',()=>{
  assert.equal(classify('Find the router file','scout').tier,'light');
  assert.equal(classify('Implement a bounded UI change','worker').tier,'standard');
  assert.equal(classify('Review OAuth permissions','reviewer').tier,'heavy');
  assert.equal(classify('Resume arquitectura de seguridad','scout').tier,'heavy');
  assert.equal(classify('Modify a.ts b.ts c.ts d.ts e.ts f.ts','worker').tier,'heavy');
});
test('no degrada un nivel explícito; escala fallos sin bucles',()=>{
  const args={task:'Find a file',role:'scout'};
  const a=decide(args,policy);assert.equal(a.effort,'low');
  const b=decide({...args,previous:{...a,failed:true}},policy);assert.equal(b.effort,'medium');
  const c=decide({...args,previous:{...b,failed:true}},policy);assert.equal(c.effort,'high');
  assert.throws(()=>decide({...args,previous:{...c,failed:true}},policy),/agotado/);
  assert.equal(decide({...args,minimum:'heavy'},policy).effort,'high');
});
test('identificador de tarea no contiene texto ni depende solo del nombre',()=>{
  const a=taskKey('private task','worker','project-a');
  assert.match(a,/^[a-f0-9]{20}$/);
  assert.notEqual(a,taskKey('private task','worker','project-b'));
});
test('normaliza niveles inválidos y conserva todos los válidos',()=>{
  for(const effort of ['low','medium','high','xhigh','max'])assert.equal(normalizeEffort({reasoning:{effort}},policy.model,policy.model),undefined);
  for(const effort of ['minimal','none',undefined])assert.equal(normalizeEffort({reasoning:{effort,summary:'auto'}},policy.model,policy.model).reasoning.effort,'low');
  assert.equal(normalizeEffort({}, {provider:'other',id:'other'},policy.model),undefined);
});
test('genera nueve agentes sin delegación recursiva y con modelo explícito',()=>{
  const agents=generateAgents(policy);assert.equal(Object.keys(agents).length,9);
  assert.match(agents['cgb-worker-standard.md'],/model: openai-codex\/gpt-6.1-sol:medium/);
  assert.match(agents['cgb-scout-light.md'],/tools: read, grep, find, ls\n/);
  assert.equal(agents['cgb-reviewer-heavy.md'].includes('bash'),false);
  for(const text of Object.values(agents))assert.ok(text.includes(delegatedMarker));
});
test('detecta errores reales aunque el proceso cierre con código cero',()=>{
  assert.equal(failedResult({details:{results:[{exitCode:0,stopReason:'error'}]}}),true);
  assert.equal(failedResult({details:{results:[{exitCode:0}]}}),false);
});
test('merge de modelos conserva endpoints, claves y definiciones locales',()=>{
  const local={providers:{'openai-codex':{apiKey:'LOCAL_SENTINEL',baseUrl:'https://example.invalid',models:[{id:'custom',contextWindow:100}]}}};
  const shared={providers:{'openai-codex':{apiKey:'oauth-managed',baseUrl:'https://chatgpt.com/backend-api',models:[{id:'gpt-6.1-sol'}]}}};
  const result=mergeModels(local,shared);
  assert.equal(result.providers['openai-codex'].apiKey,'LOCAL_SENTINEL');
  assert.equal(result.providers['openai-codex'].baseUrl,'https://example.invalid');
  assert.equal(result.providers['openai-codex'].models.length,2);
  assert.equal(local.providers['openai-codex'].models.length,1);
});
test('merge YAML conserva campos locales, cuerpo y comentarios',()=>{
  const original='---\nversion: 1\n# keep\ngit:\n  auto_push: false\nphases:\n  skip_research: true\n  custom: keep\n---\nPrivate local instructions\n';
  const shared={context_selection:'smart',phases:{skip_research:false}};
  const result=mergePreferences(original,shared);
  assert.match(result,/# keep/);assert.match(result,/auto_push: false/);assert.match(result,/custom: keep/);assert.match(result,/Private local instructions/);assert.match(result,/skip_research: false/);
  assert.equal(mergePreferences(result,shared),result);
  assert.throws(()=>mergePreferences('no frontmatter',shared));
  assert.throws(()=>mergePreferences('---\na: [\n---\n',shared));
});

async function fixture(t) {
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'sdd-toolkit-test-'));
  t.after(()=>fs.rm(home,{recursive:true,force:true}));
  return home;
}
test('setup conserva auth, modelos, skills y preferencias locales; backup e idempotencia',async t=>{
  const home=await fixture(t);const agent=path.join(home,'agent');await fs.mkdir(agent,{recursive:true});
  await fs.writeFile(path.join(agent,'auth.json'),'SECRET_SENTINEL');
  await fs.writeFile(path.join(agent,'settings.json'),JSON.stringify({defaultModel:'local-model',skills:['local'],packages:['local-package']}));
  await fs.writeFile(path.join(home,'preferences.md'),'---\nversion: 1\ngit:\n  auto_push: false\n---\nLocal body\n');
  const options={home,log:()=>{}};
  assert.equal((await setup({...options,dryRun:true})).changed,true);
  assert.equal((await fs.readdir(agent)).includes('agents'),false);
  await setup(options);
  assert.equal(await fs.readFile(path.join(agent,'auth.json'),'utf8'),'SECRET_SENTINEL');
  const settings=JSON.parse(await fs.readFile(path.join(agent,'settings.json'),'utf8'));
  assert.equal(settings.defaultModel,'local-model');assert.deepEqual(settings.skills,['local']);assert.deepEqual(settings.packages,['local-package',root]);
  assert.equal((await fs.readdir(path.join(agent,'agents'))).length,9);
  assert.match(await fs.readFile(path.join(home,'preferences.md'),'utf8'),/Local body/);
  assert.ok((await fs.readdir(path.join(home,'toolkit-backups'))).length);
  assert.equal((await setup(options)).changed,false);
  assert.equal((await setup({...options,check:true})).changed,false);
});
test('setup no sobrescribe agentes modificados ni aplica cambios parciales ante conflictos',async t=>{
  const home=await fixture(t);const dir=path.join(home,'agent','agents');await fs.mkdir(dir,{recursive:true});
  await fs.writeFile(path.join(dir,'cgb-worker-standard.md'),'LOCAL AGENT');
  await assert.rejects(setup({home,log:()=>{}}),/no se sobrescribe/i);
  await assert.rejects(fs.access(path.join(home,'agent','settings.json')));
});
test('setup nuevo, edición manual protegida y check no escribe',async t=>{
  const home=await fixture(t);await setup({home,log:()=>{}});
  const agent=path.join(home,'agent','agents','cgb-scout-light.md');await fs.appendFile(agent,'Local customization\n');
  await assert.rejects(setup({home,log:()=>{}}),/no se sobrescribe/i);
});

async function routerFixture(t) {
  const home=await fixture(t);const agentDir=path.join(home,'agent');await fs.mkdir(path.join(agentDir,'agents'),{recursive:true});
  for(const [name,content]of Object.entries(generateAgents(policy)))await fs.writeFile(path.join(agentDir,'agents',name),content);
  const hooks=new Map(),commands=new Map(),audit=[],notices=[];
  createResourceRouter({on:(name,fn)=>hooks.set(name,fn),registerCommand:(name,cmd)=>commands.set(name,cmd)},policy,{agentDir,audit:async record=>audit.push(record)});
  const ctx={cwd:home,hasUI:true,modelRegistry:{find:()=>({id:policy.model.id})},ui:{notify:(...args)=>notices.push(args),confirm:async()=>false}};
  const call=async(id,input)=>{const event={toolName:'subagent',toolCallId:id,input};const result=await hooks.get('tool_call')(event,ctx);return {event,result};};
  const finish=async(id,results,isError=false)=>hooks.get('tool_result')({toolName:'subagent',toolCallId:id,isError,details:{results}});
  return {home,agentDir,hooks,commands,audit,notices,ctx,call,finish};
}
test('hook enruta el objeto real del tool sin cambiar el texto de tarea',async t=>{
  const f=await routerFixture(t);const input={agent:'worker',task:'Implement a bounded UI change'};
  assert.equal((await f.call('1',input)).result,undefined);
  assert.equal(input.agent,'cgb-worker-standard');assert.equal(input.agentScope,'user');assert.equal(input.task,'Implement a bounded UI change');
  assert.equal(JSON.stringify(f.audit).includes('bounded UI'),false);
  await f.finish('1',[{exitCode:0}]);
});
test('fallo escala en la siguiente petición, sin reintentos automáticos',async t=>{
  const f=await routerFixture(t);const task='Find a module';
  await f.call('1',{agent:'scout',task});await f.finish('1',[{exitCode:1}]);
  const input={agent:'scout',task};await f.call('2',input);assert.equal(input.agent,'cgb-scout-standard');
  await f.finish('2',[{exitCode:1}]);const third={agent:'scout',task};await f.call('3',third);assert.equal(third.agent,'cgb-scout-heavy');
  await f.finish('3',[{exitCode:1}]);assert.equal((await f.call('4',{agent:'scout',task})).result.block,true);
});
test('errores permanentes no desencadenan escaladas inútiles',async t=>{
  const f=await routerFixture(t);const task='Find a module';await f.call('1',{agent:'scout',task});
  await f.finish('1',[{exitCode:1,errorMessage:'Model not supported'}]);
  assert.equal((await f.call('2',{agent:'scout',task})).result.block,true);
});
test('cambiar de sesión no arrastra escalados anteriores',async t=>{
  const f=await routerFixture(t);const task='Find a module';await f.call('old',{agent:'scout',task});await f.finish('old',[{exitCode:1}]);
  f.hooks.get('session_switch')({});
  const input={agent:'scout',task};await f.call('new',input);assert.equal(input.agent,'cgb-scout-light');
});
test('no modifica agentes personalizados y protege su ámbito',async t=>{
  const f=await routerFixture(t);const input={agent:'my-agent',task:'Do local work',agentScope:'project'};await f.call('1',input);
  assert.equal(input.agent,'my-agent');assert.equal(input.agentScope,'project');await f.finish('1',[{exitCode:0}]);
  assert.equal((await f.call('2',{tasks:[{agent:'worker',task:'Implement a change'},{agent:'my-agent',task:'Custom'}]})).result.block,true);
});
test('limita lotes paralelos, llamadas simultáneas y tareas duplicadas',async t=>{
  const f=await routerFixture(t);
  assert.equal((await f.call('large',{tasks:Array.from({length:3},(_,i)=>({agent:'worker',task:`Task ${i}`}))})).result.block,true);
  assert.equal((await f.call('duplicate',{tasks:[{agent:'worker',task:'same'},{agent:'worker',task:'same'}]})).result.block,true);
  await f.call('first',{agent:'worker',task:'A'});
  assert.equal((await f.call('second',{agent:'worker',task:'B'})).result.block,true);
  await f.finish('first',[{exitCode:0}]);
  assert.equal((await f.call('third',{agent:'worker',task:'B'})).result,undefined);
});
test('permite dos lectores paralelos pero no dos workers de escritura',async t=>{
  const f=await routerFixture(t);
  assert.equal((await f.call('writes',{tasks:[{agent:'worker',task:'Write A'},{agent:'worker',task:'Write B'}],isolated:true})).result.block,true);
  const input={tasks:[{agent:'scout',task:'Find A'},{agent:'reviewer',task:'Review B'}]};
  assert.equal((await f.call('reads',input)).result,undefined);
  assert.equal(input.tasks[0].agent,'cgb-scout-light');assert.equal(input.tasks[1].agent,'cgb-reviewer-standard');
});
test('limita pasos de cadena y evita crecer sin revisar resultados',async t=>{
  const f=await routerFixture(t);const chain=Array.from({length:4},(_,i)=>({agent:'scout',task:`Find ${i}`}));
  assert.equal((await f.call('long-chain',{chain})).result.block,true);
});
test('agentes delegados no pueden crear más subagentes',async t=>{
  const f=await routerFixture(t);f.hooks.get('before_agent_start')({systemPrompt:`base ${delegatedMarker}`});
  assert.equal((await f.call('nested',{agent:'worker',task:'Nested'})).result.block,true);
});
test('una llamada bloqueada por otro hook libera la reserva al finalizar',async t=>{
  const f=await routerFixture(t);await f.call('blocked',{agent:'worker',task:'A'});
  await f.hooks.get('tool_execution_end')({toolName:'subagent',toolCallId:'blocked',isError:true});
  assert.equal((await f.call('next',{agent:'worker',task:'B'})).result,undefined);
});
test('no marca completados pasos de cadena que nunca se ejecutaron',async t=>{
  const f=await routerFixture(t);const task='Find a module';
  await f.call('chain',{chain:[{agent:'scout',task:'Find another module'},{agent:'scout',task}]});
  await f.finish('chain',[{exitCode:1}]);
  const input={agent:'scout',task};await f.call('next',input);assert.equal(input.agent,'cgb-scout-light');
});
test('no acepta combinación ambigua de modos ni tareas vacías',async t=>{
  const f=await routerFixture(t);
  assert.equal((await f.call('mixed',{agent:'worker',task:'A',tasks:[{agent:'worker',task:'B'}]})).result.block,true);
  assert.equal((await f.call('empty',{agent:'worker',task:''})).result.block,true);
});
