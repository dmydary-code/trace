import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import {randomUUID} from 'node:crypto';
import {createTraceServer} from '../../server.mjs';
import {projectById} from './projects.mjs';
const exec=promisify(execFile);
export const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export async function eventually(check, message='Condition not reached', timeout=6000) {
 const end=Date.now()+timeout;let last;
 while(Date.now()<end){try{const result=await check();if(result)return result;}catch(error){last=error;}await new Promise(r=>setTimeout(r,25));}
 throw new Error(message+(last ? ': '+last.message : ''));
}
export async function freePort(url) {
 const server=createServer();await new Promise((ok,fail)=>{server.once('error',fail);server.listen(+new URL(url).port,'127.0.0.1',ok);});await new Promise(ok=>server.close(ok));
}
export async function fixture(id='javascript',{changed=true,commit=true}={}) {
 const project=projectById(id),dir=await realpath(await mkdtemp(join(tmpdir(),'trace-acceptance-'))),repo=join(dir,'repo'),cleanups=[];
 await mkdir(repo);const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',TRACE_SESSION_DIRECTORY:join(dir,'sessions')};
 delete env.CODEX_THREAD_ID;delete env.CLAUDE_SESSION_ID;delete env.TRACE_BUNDLE_HOME;
 const git=async(...args)=>(await exec('git',['-C',repo,...args],{env,timeout:10000})).stdout.trimEnd();
 const put=async(path,text)=>{await mkdir(dirname(join(repo,path)),{recursive:true});await writeFile(join(repo,path),text);};
 await git('init','-b','main');await git('config','user.name','Trace Fixture');await git('config','user.email','fixture@example.invalid');
 for(const [path,text] of Object.entries(project.files))await put(path,text);
 await put('.trace-graph.json',JSON.stringify({testDirectories:{unit:['tests/unit','Tests/PricingTests'],integration:['tests/integration'],e2e:['tests/e2e']}}));
 if(commit){await git('add','.');await git('commit','-m','fixture base');}
 if(changed)await put(project.path,project.after);
 const cli=(...args)=>exec(process.execPath,[join(root,'bin/trace.mjs'),...args,'--repo',repo],{env,timeout:10000});
 const hook=async(event,sessionId='fixture-session',source='startup')=>{
  const child=spawn(process.execPath,[join(root,'plugins/trace/hooks/session.mjs')],{env,stdio:['pipe','pipe','pipe']});
  let stderr='';child.stderr.on('data',d=>stderr+=d);child.stdout.resume();
  const done=new Promise((ok,fail)=>{child.once('error',fail);child.once('close',code=>code===0?ok():fail(Error(stderr)));});
  child.stdin.end(JSON.stringify({hook_event_name:event,session_id:sessionId,source}));await done;
 };
 const server=async(options={})=>{const app=await createTraceServer({repo,...options});cleanups.push(()=>app.close());return app;};
 const start=async({sessionId='fixture-session',lease=true,args=[]}={})=>{
  if(lease)await hook('SessionStart',sessionId);
  const child=spawn(process.execPath,[join(root,'bin/trace.mjs'),'review','--repo',repo,'--wait','--json','--no-open',...(lease?['--session-id',sessionId]:[]),...args],{env,stdio:['ignore','pipe','pipe']});
  let output='',stderr='';const events=[];let code;
  const exited=new Promise((ok,fail)=>{child.once('error',fail);child.once('close',value=>{code=value;ok(value);});});
  child.stderr.on('data',d=>stderr=(stderr+d).slice(-16000));
  child.stdout.on('data',d=>{output+=d;while(output.includes('\n')){const n=output.indexOf('\n'),line=output.slice(0,n);output=output.slice(n+1);try{events.push(JSON.parse(line));}catch{stderr+='Invalid JSON event: '+line;}}});
  cleanups.push(async()=>{for(const event of events)if(event.viewerPid){try{process.kill(event.viewerPid,'SIGTERM');}catch{}}if(code===undefined)child.kill('SIGTERM');await Promise.race([exited,new Promise(r=>{const timer=setTimeout(r,1000);timer.unref();})]);});
  const ready=await eventually(()=>{if(code!==undefined)throw Error(stderr||'CLI exited before ready: '+code);return events.find(e=>e.event==='ready');},'No ready event');
  return {child,events,ready,exited,get code(){return code;},get stderr(){return stderr;},end:()=>hook('SessionEnd',sessionId)};
 };
 return {repo,dir,project,git,put,cli,hook,start,server,env,read:path=>readFile(join(repo,path),'utf8'),async dispose(){for(const cleanup of cleanups.reverse())await cleanup();await rm(dir,{recursive:true,force:true});}};
}
export async function session(app){const res=await fetch(app.url+'/api/session',{signal:AbortSignal.timeout(10000)});assert.equal(res.status,200);return res.json();}
export function comment(s,path=s.files[0].path,kind='add',body='Include shipping in the total.') {
 const f=s.files.find(f=>f.path===path),index=f.lines.findIndex(l=>l.kind===kind);assert(index>=0,'Fixture has '+kind+' line');const line=f.lines[index];
 return {id:randomUUID(),path,index,line:line.new??line.old,side:kind==='del'?'old':'new',body};
}
export async function post(app,s,path='/api/reviews',data={},headers={}) {
 return fetch(app.url+path,{method:'POST',signal:AbortSignal.timeout(10000),headers:{Origin:app.url,'X-Trace-Token':s.token,'Content-Type':'application/json',...headers},body:JSON.stringify({revision:s.revision,comments:[],...data})});
}
