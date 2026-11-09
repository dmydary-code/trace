import test from '../support/test.mjs';
import assert from 'node:assert/strict';
import {installAgents} from '../../lib/install-agents.mjs';
const stable='/opt/homebrew/opt/trace-review/libexec';
function adapter(options={}){
 const calls=[],logs=[],sources={codex:options.source??stable,claude:options.source??stable};
 return {calls,logs,root:stable,version:'0.5.2',target:options.target||'all',log:s=>logs.push(s),canonical:async p=>p,pin:async()=>{},read:async()=>JSON.stringify({version:options.manifestVersion||'0.5.2'}),execute:async(agent,args)=>{
  calls.push([agent,...args]);if(options.fail===agent)throw Error('Missing or unauthorized '+agent);
  if(args[1]==='marketplace'){
   if(args[2]==='list'){const list=sources[agent]?[{name:'trace-tools',path:sources[agent]}]:[];return JSON.stringify(agent==='codex'?{marketplaces:list}:list);}
   if(args[2]==='remove')sources[agent]=null;if(args[2]==='add')sources[agent]=args[3];return '';
  }
  if(args[1]==='list'){const p={id:'trace@trace-tools',version:options.version||'0.5.2',enabled:options.enabled!==false,installPath:'/isolated/cache'};return JSON.stringify(agent==='codex'?{installed:[p]}:[p]);}return '';
 }};
}
for(const target of ['codex','claude','all'])test('A-01 isolated installer verifies '+target,async()=>{const a=adapter({target,source:''}),result=await installAgents(a);assert(result.every(r=>r.ok&&r.version==='0.5.2'&&r.enabled&&r.source===stable));for(const agent of target==='all'?['codex','claude']:[target])assert(a.calls.some(c=>c[0]===agent&&c[1]==='plugin'&&c[2]==='marketplace'&&c[3]==='add'));});
for(const fail of ['codex','claude'])test('A-02 '+fail+' failure does not block other installation',async()=>{const a=adapter({fail}),result=await installAgents(a);assert.equal(result.find(r=>r.agent===fail).ok,false);assert.equal(result.find(r=>r.agent!==fail).ok,true);assert.equal(a.logs.filter(l=>l.includes('FAILED')).length,1);});
for(const source of ['/opt/homebrew/Cellar/trace/0.2.4/libexec','/opt/homebrew/Cellar/trace-review/0.5.0/libexec'])test('A-03 migration from '+source,async()=>{const a=adapter({source}),result=await installAgents(a);assert(result.every(r=>r.ok&&r.source===stable));});
for(const options of [{version:'0.5.0'},{manifestVersion:'0.4.1'},{enabled:false},{source:'/unrelated/plugin'}])test('A-04 installer reports '+JSON.stringify(options),async()=>{const a=adapter(options),result=await installAgents(a);assert(result.every(r=>!r.ok));if(options.source)assert(!a.calls.some(c=>c.includes('remove')));});
