import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { root } from './setup.mjs';
import { generateAgents } from './resource-policy.mjs';
import { createResourceRouter } from '../extensions/resource-router.js';

const args=process.argv.slice(2);
const index=args.indexOf('--sdd-root');
const packageRoot=index>=0?args[index+1]:process.env.SDD_PACKAGE_DIR;
if(!packageRoot){console.error('Uso: npm run check:sdk -- --sdd-root RUTA_AL_PAQUETE_SDD_PI');process.exitCode=1;}
else {
  let temporary;
  try {
    const location=path.resolve(packageRoot);
    const pkg=JSON.parse(await fs.readFile(path.join(location,'package.json'),'utf8'));
    if(pkg.name!=='sdd-pi')throw new Error('La ruta no es un paquete sdd-pi.');
    temporary=await fs.mkdtemp(path.join(os.tmpdir(),'sdd-sdk-check-'));
    process.env.PI_PACKAGE_DIR=path.join(location,'pkg');
    process.env.SDD_HOME=temporary;
    process.env.SDD_CODING_AGENT_DIR=path.join(temporary,'agent');
    const core=path.join(location,'packages','pi-coding-agent','dist','core');
    const loader=await import(pathToFileURL(path.join(core,'extensions','loader.js')).href);
    const wrapper=await import(pathToFileURL(path.join(core,'extensions','wrapper.js')).href);
    const resolver=await import(pathToFileURL(path.join(core,'model-resolver.js')).href);
    const loaded=await loader.loadExtensions([path.join(root,'extensions','resource-router.js')],root);
    assert.deepEqual(loaded.errors,[],'La extensión debe cargar sin errores en el SDK real.');
    assert.ok(loaded.extensions[0].commands.has('sdd-toolkit'));
    const policy=JSON.parse(await fs.readFile(path.join(root,'config','resource-policy.json'),'utf8'));
    const model={provider:policy.model.provider,id:policy.model.id,api:'openai-codex-responses',reasoning:true};
    for(const effort of ['low','medium','high']) {
      const resolved=resolver.resolveCliModel({cliModel:`${model.provider}/${model.id}:${effort}`,modelRegistry:{getAll:()=>[model]}});
      assert.equal(resolved.error,undefined);assert.equal(resolved.thinkingLevel,effort);
    }
    const agentDir=path.join(temporary,'agent');await fs.mkdir(path.join(agentDir,'agents'),{recursive:true});
    for(const [name,content]of Object.entries(generateAgents(policy)))await fs.writeFile(path.join(agentDir,'agents',name),content);
    const discovery=await import(pathToFileURL(path.join(location,'dist','resources','extensions','subagent','agents.js')).href);
    const found=discovery.discoverAgents(root,'user').agents;
    assert.equal(found.filter(agent=>agent.name.startsWith('cgb-')).length,9,'El subagent nativo debe descubrir los nueve agentes de usuario.');
    const handlers=new Map();
    createResourceRouter({on:(name,fn)=>handlers.set(name,fn),registerCommand:()=>{}},policy,{agentDir});
    const ctx={cwd:root,modelRegistry:{find:()=>model},ui:{notify:()=>{}}};
    const runner={hasHandlers:name=>handlers.has(name),emitToolCall:event=>handlers.get('tool_call')(event,ctx),emitToolResult:event=>handlers.get('tool_result')(event,ctx)};
    let received;
    const tool=wrapper.wrapToolWithExtensions({name:'subagent',execute:async(_id,params)=>{received=params;return {content:[],details:{results:[{exitCode:0}]}};}},runner);
    await tool.execute('sdk-check',{agent:'worker',task:'Implement a small UI change'});
    assert.equal(received.agent,'cgb-worker-standard');assert.equal(received.agentScope,'user');
    console.log(`PASS: SDD ${pkg.version}; carga real, descubrimiento de agentes, sufijos low/medium/high y enrutamiento a través del wrapper real del SDK.`);
    console.log('Sin llamadas a proveedores, sin credenciales y sin modificar la instalación del SDK.');
  }catch(error){console.error(`Compatibilidad NO verificada: ${error.message}`);process.exitCode=1;}
  finally{if(temporary)await fs.rm(temporary,{recursive:true,force:true});}
}
