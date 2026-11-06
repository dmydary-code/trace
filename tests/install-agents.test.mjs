import test from 'node:test';import assert from 'node:assert/strict';
import {installAgents} from '../lib/install-agents.mjs';
import {stableTraceRoot} from '../lib/install-source.mjs';
const root='/opt/homebrew/Cellar/trace-review/0.4.1/libexec',stable='/opt/homebrew/opt/trace-review/libexec';
function fixture({codexFails=false,wrongVersion=false,disabled=false,broken=false}={}){
 const calls=[],sources={codex:broken?'/opt/homebrew/Cellar/trace/0.2.3/libexec':stable,claude:stable};
 const execute=async(agent,args)=>{
  calls.push([agent,...args]);if(codexFails&&agent==='codex')throw new Error('Codex is unavailable');
  if(args[1]==='marketplace'){
   if(args[2]==='list'){
    if(broken&&agent==='codex'&&sources.codex?.includes('0.2.3'))throw new Error('failed to load marketplace(s):\n- `trace-tools` at '+sources.codex+': marketplace root does not contain a supported manifest');
    const list=sources[agent]?[{name:'trace-tools',path:sources[agent]}]:[];
    return JSON.stringify(agent==='codex'?{marketplaces:list}:list);
   }
   if(args[2]==='remove')sources[agent]=null;
   if(args[2]==='add')sources[agent]=args[3];
   return '';
  }
  if(args[1]==='list'){
   const plugin={id:'trace@trace-tools',version:wrongVersion?'0.2.4':'0.4.1',enabled:!disabled,installPath:'/cache/trace'};
   return JSON.stringify(agent==='codex'?{installed:[plugin]}:[plugin]);
  }
  return '';
 };
 return {calls,execute,pin:async()=>{},canonical:async p=>p,read:async()=>JSON.stringify({version:'0.4.1'}),log:()=>{}};
}
test('all continues to Claude after Codex failure and reports each outcome',async()=>{
 const f=fixture({codexFails:true});const result=await installAgents({target:'all',root,version:'0.4.1',...f});
 assert.equal(result[0].ok,false);assert.equal(result[1].ok,true);assert.equal(result[1].source,stable);
});
test('repairs a missing old Homebrew source and registers the stable path',async()=>{
 const f=fixture({broken:true});const result=await installAgents({target:'codex',root,version:'0.4.1',...f});
 assert.equal(result[0].ok,true);assert(f.calls.some(c=>c.join(' ')==='codex plugin marketplace add '+stable));
 assert.equal(stableTraceRoot('/tmp/trace'),'/tmp/trace');
});
test('stale versions and disabled plugins are failures, not successful installs',async()=>{
 for(const options of [{wrongVersion:true},{disabled:true}]){
  const result=await installAgents({target:'claude',root,version:'0.4.1',...fixture(options)});assert.equal(result[0].ok,false);
 }
});
