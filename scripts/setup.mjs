import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';
import { validatePolicy, generateAgents } from './resource-policy.mjs';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=text=>createHash('sha256').update(text).digest('hex');
const json=text=>JSON.parse(text);
export function mergeModels(current, shared) {
  const result=structuredClone(current);
  result.providers??={};
  for(const [provider,value]of Object.entries(shared.providers)) {
    result.providers[provider]??={};
    const target=result.providers[provider];
    // Preserve local endpoint/auth customizations and existing model definitions.
    for(const key of ['baseUrl','api','apiKey']) if(target[key]===undefined) target[key]=value[key];
    target.models??=[];
    for(const model of value.models) if(!target.models.some(m=>m.id===model.id))target.models.push(model);
  }
  return result;
}
export function mergePreferences(original, shared) {
  const match=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(original);
  if(original&&!match)throw new Error('preferences.md no tiene frontmatter reconocible; no se sobrescribe.');
  const doc=parseDocument(match?.[1]??'{}');
  if(doc.errors.length)throw new Error('YAML inválido en preferences.md; no se modifica.');
  const value=doc.toJS();
  if(value!==null&&(typeof value!=='object'||Array.isArray(value)))throw new Error('Las preferencias deben ser un mapa YAML.');
  const before=JSON.stringify(value??{});
  const apply=(object,trail=[])=>{
    for(const [key,value]of Object.entries(object)) {
      const keys=[...trail,key];
      if(value&&typeof value==='object'&&!Array.isArray(value)) {
        const existing=doc.getIn(keys,true);
        if(existing && existing.constructor.name!=='YAMLMap' && existing.value!==null) throw new Error(`Preferencia incompatible: ${keys.join('.')}`);
        if(!existing||existing.value===null)doc.setIn(keys,doc.createNode({}));
        apply(value,keys);
      }else doc.setIn(keys,value);
    }
  };
  apply(shared);
  if(match&&JSON.stringify(doc.toJS())===before)return original;
  return `---\n${doc.toString().trimEnd()}\n---\n${match?.[2]??'\n# SDD preferences\n'}`;
}
const read=async(file,fallback)=>{try{return await fs.readFile(file,'utf8');}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
export async function setup({home=process.env.SDD_HOME||path.join(os.homedir(),'.sdd'),packageRoot=root,dryRun=false,check=false,log=console.log}={}) {
  const policy=validatePolicy(json(await fs.readFile(path.join(packageRoot,'config/resource-policy.json'),'utf8')));
  const sharedModels=json(await fs.readFile(path.join(packageRoot,'config/models.shared.json'),'utf8'));
  const sharedPrefs=json(await fs.readFile(path.join(packageRoot,'config/preferences.shared.json'),'utf8'));
  const agentDir=path.join(home,'agent');
  const settingsPath=path.join(agentDir,'settings.json');
  const modelsPath=path.join(agentDir,'models.json');
  const preferencesPath=path.join(home,'preferences.md');
  const statePath=path.join(home,'toolkit-state','managed-agents.json');
  const settingsText=await read(settingsPath,'{}');
  const settings=json(settingsText);
  if(!settings||typeof settings!=='object'||Array.isArray(settings))throw new Error('settings.json no es un objeto.');
  settings.packages??=[];
  if(!Array.isArray(settings.packages))throw new Error('packages debe ser un array.');
  const source=e=>typeof e==='string'?e:e.source;
  if(!settings.packages.some(e=>source(e)===packageRoot))settings.packages.push(packageRoot);
  const modelsText=await read(modelsPath,'{}');
  const models=mergeModels(json(modelsText),sharedModels);
  const preferencesText=await read(preferencesPath,'');
  const preferences=mergePreferences(preferencesText,sharedPrefs);
  const managed=json(await read(statePath,'{}'));
  const generated=generateAgents(policy);
  const changes=[];
  const plan=async(file,content)=>{const original=await read(file,undefined);if(content!==original)changes.push({file,content,original});};
  if(JSON.stringify(json(settingsText))!==JSON.stringify(settings))await plan(settingsPath,JSON.stringify(settings,null,2)+'\n');
  if(JSON.stringify(json(modelsText))!==JSON.stringify(models))await plan(modelsPath,JSON.stringify(models,null,2)+'\n');
  if(preferences!==preferencesText)await plan(preferencesPath,preferences);
  const nextManaged={};
  for(const [name,content]of Object.entries(generated)) {
    const file=path.join(agentDir,'agents',name);
    const original=await read(file,undefined);
    if(original!==undefined&&original!==content&&managed[name]!==hash(original))throw new Error(`Agente editado o ajeno: ${name}. No se sobrescribe.`);
    await plan(file,content);nextManaged[name]=hash(content);
  }
  await plan(statePath,JSON.stringify(nextManaged,null,2)+'\n');
  if(!changes.length){log('Toolkit SDD al día.');return {changed:false,files:[]};}
  log(`Archivos a actualizar: ${changes.map(c=>path.relative(home,c.file)).join(', ')}`);
  if(check||dryRun)return {changed:true,files:changes.map(c=>c.file)};
  // Validate and plan everything before writing. Back up original files first.
  const backup=path.join(home,'toolkit-backups',`${Date.now()}-${process.pid}`);
  for(const change of changes.filter(c=>c.original!==undefined)) {
    const target=path.join(backup,path.relative(home,change.file));await fs.mkdir(path.dirname(target),{recursive:true});
    await fs.writeFile(target,change.original,{mode:0o600,flag:'wx'});
  }
  for(const change of changes) {
    await fs.mkdir(path.dirname(change.file),{recursive:true});
    const temporary=`${change.file}.cgb-${process.pid}.tmp`;
    try{await fs.writeFile(temporary,change.content,{mode:0o600,flag:'wx'});await fs.rename(temporary,change.file);}finally{await fs.rm(temporary,{force:true});}
  }
  log('Toolkit aplicado. Copias locales en toolkit-backups; reinicia SDD. No se han tocado auth.json ni Pi normal.');
  return {changed:true,files:changes.map(c=>c.file)};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{
    const args=process.argv.slice(2);let home=process.env.SDD_HOME||path.join(os.homedir(),'.sdd');let check=false,dryRun=false;
    for(let i=0;i<args.length;i++){
      if(args[i]==='--check')check=true;else if(args[i]==='--dry-run')dryRun=true;
      else if(args[i]==='--home'&&args[i+1])home=path.resolve(args[++i]);
      else throw new Error(`Argumento no reconocido o incompleto: ${args[i]}`);
    }
    const result=await setup({home,check,dryRun});if(check&&result.changed)process.exitCode=1;
  }catch(error){console.error(`No aplicado: ${error.message}`);process.exitCode=1;}
}
