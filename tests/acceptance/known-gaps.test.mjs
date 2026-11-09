// Desired contracts which expose baseline defects. These tests deliberately fail
// on 0.5.2; run via test:acceptance. Do not weaken assertions or mark them skipped.
import test from '../support/test.mjs';
import assert from 'node:assert/strict';
import {fixture,session,post,eventually} from '../support/harness.mjs';
import {openRepository} from '../../lib/git.mjs';
import {buildGraph} from '../../lib/graph.mjs';
import {diffTokens} from '../../dist/usages.mjs';
for(const agent of ['codex','claude'])test('R-12/B-02 '+agent+' second round emits feedback to the initiating waiter',async t=>{
 const f=await fixture();t.after(()=>f.dispose());const run=await f.start({sessionId:agent}),app={url:run.ready.url},s=await session(app);
 const first=await post(app,s,undefined,{instruction:'Round one'});assert.equal(first.status,201);const {id}=await first.json();await run.exited;
 assert.equal((await post(app,s,'/api/reviews/'+id+'/approve')).status,200);assert.equal((await post(app,s,'/api/reviews/'+id+'/continue')).status,200);
 const second=await post(app,s,undefined,{instruction:'Round two'});assert.equal(second.status,201);
 await eventually(()=>run.events.filter(e=>e.event==='feedback').length===2,'Saved round two has no second feedback event for the initiating agent',500);
});
test('G-14 comments and string examples do not fabricate imports',async t=>{
 const f=await fixture();t.after(()=>f.dispose());await f.put('src/example.js',"// import { subtotal } from './subtotal.js';\nconst example = \"import { subtotal } from './subtotal.js';\";\n");
 const g=await buildGraph(f.repo,await(await openRepository(f.repo)).snapshot());assert.deepEqual(g.edges.filter(e=>e.source==='src/example.js'),[]);
});
for(const [path,text,allowed] of [
 ['pricing.py','# subtotal is documentation\nreturn amount',['amount']],
 ['pricing.go','return len(items)',['items']],
 ['pricing.cpp','std::cout << amount;',['amount']],
 ['pricing.py','text = """example\nsubtotal documentation\n"""',['text']],
])test('UI-06/B-04 lexer excludes native comments/strings/globals in '+path+' '+JSON.stringify(text.split('\n')[0]),()=>{
 assert.deepEqual(diffTokens(text.split('\n').map((text,i)=>({kind:'add',text,new:i+1})),'new',path).map(t=>t.name),allowed);
});
test('L-10 session end terminates viewer while a Graph Git read is still blocked',async t=>{
 const f=await fixture();t.after(()=>f.dispose());const fs=await import('node:fs/promises'),path=await import('node:path'),cp=await import('node:child_process');
 const marker=path.join(f.dir,'graph-read'),enabled=path.join(f.dir,'block-graph'),release=path.join(f.dir,'release-graph'),wrapper=path.join(f.dir,'controlled-git');const git=cp.execFileSync('which',['git'],{encoding:'utf8'}).trim();
 await fs.writeFile(wrapper,'#!'+process.execPath+'\nconst fs=require("node:fs"),cp=require("node:child_process");function run(){const r=cp.spawnSync('+JSON.stringify(git)+',process.argv.slice(2),{stdio:"inherit"});process.exitCode=r.status??1;}if(!fs.existsSync('+JSON.stringify(enabled)+'))run();else{fs.writeFileSync('+JSON.stringify(marker)+',"read");const timer=setInterval(()=>{if(fs.existsSync('+JSON.stringify(release)+')){clearInterval(timer);run();}},10);}\n',{mode:0o755});
 f.env.TRACE_GIT_BIN=wrapper;const run=await f.start({sessionId:'graph-inflight'}),app={url:run.ready.url},s=await session(app);await post(app,s,undefined,{instruction:'Check shipping'});await run.exited;await fs.writeFile(enabled,'block');
 const request=fetch(app.url+'/api/graph?revision='+s.revision).catch(()=>null);
 try{
  await eventually(()=>fs.access(marker).then(()=>true,()=>false));await run.end();
  await eventually(()=>{try{process.kill(run.ready.viewerPid,0);return false;}catch(error){return error.code==='ESRCH';}},'Viewer process remains alive while its Git child is blocked',1800);
 }finally{await fs.writeFile(release,'go');await request;}
});
