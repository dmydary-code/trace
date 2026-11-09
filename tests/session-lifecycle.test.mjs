import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {watchSession} from '../lib/session-lifecycle.mjs';
const exec=promisify(execFile);
const hook=resolve('plugins/trace/hooks/session.mjs');
async function runHook(env,input){return exec(process.execPath,['--input-type=module','-e',`import {handleSession} from ${JSON.stringify('file://'+hook)};await handleSession(${JSON.stringify(input)});`],{env});}
async function until(check){for(let i=0;i<100;i++){if(await check())return;await new Promise(r=>setTimeout(r,25));}assert.fail('Timed out');}
test('session end closes only its own viewer; compact preserves it and clear replaces its lease',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'trace-session-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const env={...process.env,TRACE_SESSION_DIRECTORY:dir};
 await runHook(env,{session_id:'one',hook_event_name:'SessionStart',source:'startup'});
 await runHook(env,{session_id:'two',hook_event_name:'SessionStart',source:'startup'});
 const lease=async id=>JSON.parse((await exec(process.execPath,['--input-type=module','-e',`import {sessionLease} from ${JSON.stringify('file://'+hook)};console.log(JSON.stringify(await sessionLease(${JSON.stringify(id)})));`],{env})).stdout);
 const one=await lease('one'),two=await lease('two');let closedOne=false,closedTwo=false;
 t.after(watchSession(one,()=>{closedOne=true;},10));t.after(watchSession(two,()=>{closedTwo=true;},10));
 await runHook(env,{session_id:'one',hook_event_name:'SessionStart',source:'compact'});
 assert.equal((await lease('one')).token,one.token);
 await runHook(env,{session_id:'one',hook_event_name:'SessionEnd'});
 await until(()=>closedOne);assert.equal(closedTwo,false);
 await runHook(env,{session_id:'two',hook_event_name:'SessionStart',source:'clear'});
 await until(()=>closedTwo);assert.notEqual((await lease('two')).token,two.token);
});
test('owner process exit triggers shutdown even if SessionEnd was not delivered',async t=>{
 const owner=spawn(process.execPath,['-e','setInterval(()=>{},1000)']);t.after(()=>owner.kill());
 let closed=false;t.after(watchSession({ownerPid:owner.pid},()=>{closed=true;},10));
 owner.kill();await until(()=>closed);
});
test('submitted viewer stays available until session ends, then releases its port', {timeout:15000},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'trace-owned-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const repo=join(dir,'repo');await exec('git',['init',repo]);
 await writeFile(join(repo,'file.ts'),'export const count=1;\n');
 const env={...process.env,TRACE_SESSION_DIRECTORY:join(dir,'sessions')};
 await runHook(env,{session_id:'review',hook_event_name:'SessionStart',source:'startup'});
 const child=spawn(process.execPath,[resolve('bin/trace.mjs'),'--repo',repo,'--wait','--json','--no-open','--session-id','review'],{env,stdio:['ignore','pipe','pipe']});
 t.after(()=>child.kill());let errors='';child.stderr.on('data',d=>errors+=d);let output='';child.stdout.on('data',d=>output+=d);let code;child.on('exit',c=>code=c);
 await until(()=>{if(code!==undefined && !output)throw Error(errors);return output.includes('\n');});const ready=JSON.parse(output.split('\n')[0]);t.after(()=>{try{process.kill(ready.viewerPid);}catch{}});
 const session=await(await fetch(ready.url+'/api/session')).json();
 const res=await fetch(ready.url+'/api/reviews',{method:'POST',headers:{Origin:ready.url,'X-Trace-Token':session.token},body:JSON.stringify({revision:session.revision,comments:[],instruction:'Check this'})});assert.equal(res.status,201);
 await until(()=>code!==undefined);assert.equal(code,0);
 assert.equal((await fetch(ready.url+'/api/session')).status,200);
 await runHook(env,{session_id:'review',hook_event_name:'SessionEnd',reason:'clear'});
 await until(()=>fetch(ready.url).then(()=>false,()=>true));
 const net=await import('node:net');const server=net.createServer();await new Promise((ok,fail)=>{server.once('error',fail);server.listen(Number(new URL(ready.url).port),'127.0.0.1',ok);});await new Promise(ok=>server.close(ok));
});
test('without a session lease inactive browser ownership does not leave a detached server', {timeout:15000},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'trace-unowned-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await exec('git',['init',dir]);await writeFile(join(dir,'file.ts'),'export const count=1;\n');
 const env={...process.env};delete env.CODEX_THREAD_ID;delete env.CLAUDE_SESSION_ID;
 const child=spawn(process.execPath,[resolve('bin/trace.mjs'),'--repo',dir,'--wait','--json','--no-open','--viewer-idle-timeout','0.1'],{env,stdio:['ignore','pipe','pipe']});
 t.after(()=>child.kill());let output='',errors='';let code;child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>errors+=d);child.on('exit',c=>code=c);
 await until(()=>{if(code!==undefined&&!output)throw Error(errors);return output.includes('\n');});const ready=JSON.parse(output.split('\n')[0]);t.after(()=>{try{process.kill(ready.viewerPid);}catch{}});
 const session=await(await fetch(ready.url+'/api/session')).json();
 const result=await fetch(ready.url+'/api/reviews',{method:'POST',headers:{Origin:ready.url,'X-Trace-Token':session.token},body:JSON.stringify({revision:session.revision,comments:[],instruction:'Check this'})});assert.equal(result.status,201);
 await until(()=>code!==undefined);assert.equal(code,0);await until(()=>fetch(ready.url).then(()=>false,()=>true));
});
