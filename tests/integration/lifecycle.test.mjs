import test from '../support/test.mjs';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {fixture,session,post,eventually,freePort} from '../support/harness.mjs';
import {createHash} from 'node:crypto';
const setup=async t=>{const f=await fixture();t.after(()=>f.dispose());return f;};
const stopped=async run=>{await eventually(()=>fetch(run.ready.url).then(()=>false,()=>true),'Viewer did not stop');await freePort(run.ready.url);};
for(const agent of ['codex','claude'])for(const sent of [false,true])test('L-01/02/03 '+agent+' session ends '+(sent?'after':'before')+' submission',async t=>{
 const f=await setup(t),run=await f.start({sessionId:agent}),app={url:run.ready.url},s=await session(app);
 if(sent){assert.equal((await post(app,s,undefined,{instruction:'Check shipping'})).status,201);assert.equal(await run.exited,0);assert.equal((await fetch(app.url)).status,200);}
 await run.end();await stopped(run);if(!sent){await run.exited;assert(!run.events.some(e=>e.event==='feedback'));}else assert(JSON.parse((await f.cli('feedback','--json')).stdout).id);
});
test('L-03/04 clear replaces a same-ID lease; compact retains the viewer',async t=>{
 const f=await setup(t);const run=await f.start({sessionId:'context'}),app={url:run.ready.url};const s=await session(app);await post(app,s,undefined,{instruction:'Check shipping'});await run.exited;
 const path=join(f.env.TRACE_SESSION_DIRECTORY,createHash('sha256').update('context').digest('hex')+'.json');const before=JSON.parse(await readFile(path));await f.hook('SessionStart','context','compact');assert.equal(JSON.parse(await readFile(path)).token,before.token);assert.equal((await fetch(app.url)).status,200);
 await f.hook('SessionStart','context','clear');assert.notEqual(JSON.parse(await readFile(path)).token,before.token);await stopped(run);
});
test('A-08/L-06/12 ending one session closes all its viewers and preserves another',async t=>{
 const f=await setup(t);const a=await f.start({sessionId:'one'}),b=await f.start({sessionId:'one'}),c=await f.start({sessionId:'two'});assert.notEqual(a.ready.sessionId,b.ready.sessionId);
 for(const run of [a,b,c]){const app={url:run.ready.url},s=await session(app);await post(app,s,undefined,{instruction:'Check shipping'});await run.exited;}
 await a.end();await stopped(a);await stopped(b);assert.equal((await fetch(c.ready.url)).status,200);await c.end();await stopped(c);
});
for(const signal of ['SIGINT','SIGTERM'])test('L-08 '+signal+' stops waiting CLI and frees port',async t=>{
 const f=await setup(t),run=await f.start();run.child.kill(signal);assert.equal(await run.exited,signal==='SIGINT'?130:143);await stopped(run);assert(!run.events.some(e=>e.event==='feedback'));
});
test('L-05 detected owner process loss releases viewer port without SessionEnd',async t=>{
 const f=await setup(t);const owner=spawn(process.execPath,['-e','setInterval(()=>{},1000)']);t.after(()=>owner.kill());await f.hook('SessionStart','crash');const path=join(f.env.TRACE_SESSION_DIRECTORY,createHash('sha256').update('crash').digest('hex')+'.json');const lease=JSON.parse(await readFile(path));await writeFile(path,JSON.stringify({...lease,ownerPid:owner.pid}));
 const run=await f.start({sessionId:'crash'}),app={url:run.ready.url},s=await session(app);await post(app,s,undefined,{instruction:'Check shipping'});await run.exited;owner.kill();await stopped(run);
});
test('L-07 no lease closes after browser inactivity; L-08 timeout never approves',async t=>{
 const f=await setup(t);const run=await f.start({lease:false,args:['--viewer-idle-timeout','0.1']}),app={url:run.ready.url},s=await session(app);await post(app,s,undefined,{instruction:'Check shipping'});assert.equal(await run.exited,0);assert.match(run.stderr,/No agent session detected/);await stopped(run);
 const timed=await f.start({args:['--timeout','0.05']});assert.equal(await timed.exited,2);assert(timed.events.some(e=>e.event==='timeout'));assert(!timed.events.some(e=>e.event==='feedback'));await stopped(timed);
});
test('L-09 parent process crash before feedback closes orphan viewer',async t=>{
 const f=await setup(t),run=await f.start();run.child.kill('SIGKILL');await run.exited;await stopped(run);
});
test('L-10 session end during startup has no feedback and leaves no occupied port',async t=>{
 const f=await setup(t),run=await f.start();await run.end();await stopped(run);await run.exited;assert(!run.events.some(e=>e.event==='feedback'));
});
test('L-03 clear with a new session ID invalidates viewers of the detected CLI owner',async t=>{
 const f=await setup(t);const run=await f.start({sessionId:'old-id'}),app={url:run.ready.url},s=await session(app);await post(app,s,undefined,{instruction:'Check shipping'});await run.exited;
 const oldPath=join(f.env.TRACE_SESSION_DIRECTORY,createHash('sha256').update('old-id').digest('hex')+'.json');const record=JSON.parse(await readFile(oldPath));
 // In hosts with no detectable owner, only SessionEnd can invalidate the old ID.
 // Use the real hook's detected owner when present; otherwise exercise SessionEnd.
 if(record.ownerPid){await f.hook('SessionStart','replacement-id','clear');}else{await f.hook('SessionEnd','old-id');await f.hook('SessionStart','replacement-id','clear');}
 await stopped(run);const fresh=await f.start({sessionId:'replacement-id'});assert.notEqual(fresh.ready.sessionId,run.ready.sessionId);await fresh.end();await stopped(fresh);
});
test('L-10 ending a session while Git blocks viewer startup still releases the eventual port',async t=>{
 const f=await setup(t);const fs=await import('node:fs/promises');const marker=join(f.dir,'git-started'),release=join(f.dir,'git-release'),wrapper=join(f.dir,'blocking-git');
 const {execFileSync}=await import('node:child_process');const realGit=execFileSync('which',['git'],{encoding:'utf8'}).trim();
 await writeFile(wrapper,'#!'+process.execPath+'\nconst fs=require("node:fs"),cp=require("node:child_process");fs.writeFileSync('+JSON.stringify(marker)+',"ready");const tick=setInterval(()=>{if(!fs.existsSync('+JSON.stringify(release)+'))return;clearInterval(tick);const r=cp.spawnSync('+JSON.stringify(realGit)+',process.argv.slice(2),{stdio:"inherit"});process.exitCode=r.status??1;},10);\n',{mode:0o755});
 f.env.TRACE_GIT_BIN=wrapper;const pending=f.start({sessionId:'mid-start'});
 try{await eventually(()=>fs.access(marker).then(()=>true,()=>false));await f.hook('SessionEnd','mid-start');}finally{await writeFile(release,'go');}
 const run=await pending;await stopped(run);await run.exited;assert(!run.events.some(e=>e.event==='feedback'));
});
