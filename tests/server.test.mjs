import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {execFile,spawn} from 'node:child_process';import {promisify} from 'node:util';
const exec=promisify(execFile);
test('local handoff validates snapshot and invokes an agent through stdin',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'trace-test-')),repo=join(dir,'repo'),bin=join(dir,'bin');await mkdir(repo);await mkdir(bin);
 const git=(...args)=>exec('git',['-C',repo,...args]);await git('init');await git('config','user.name','Trace Test');await git('config','user.email','test@example.invalid');await writeFile(join(repo,'a.ts'),'const total = 10;\n');await git('add','.');await git('commit','-m','fixture');await writeFile(join(repo,'a.ts'),'const total = 20;\n');
 await writeFile(join(bin,'codex'),'#!/usr/bin/env node\nimport("node:fs").then(fs=>{let input="";process.stdin.on("data",d=>input+=d);process.stdin.on("end",()=>{fs.writeFileSync("received.txt",input);const a=process.argv;fs.writeFileSync(a[a.indexOf("-o")+1],"Fixture agent received review");});});\n',{mode:0o755});
 const port=14873,origin=`http://127.0.0.1:${port}`;const child=spawn(process.execPath,[resolve('server.mjs'),'--repo',repo,'--port',String(port),'--agent','codex'],{cwd:dir,env:{...process.env,PATH:bin+':'+process.env.PATH},stdio:['ignore','pipe','pipe']});
 try{await new Promise((ok,no)=>{child.stdout.once('data',ok);child.once('error',no);child.once('exit',code=>no(new Error('server exit '+code)))});
 const s=await (await fetch(origin+'/api/session')).json();const f=s.files[0],index=f.lines.findIndex(l=>l.kind==='add'),l=f.lines[index];const packet={revision:s.revision,comments:[{path:f.path,index,line:l.new,side:'new',body:'Check the total'}]};
 const post=(p,headers={})=>fetch(origin+'/api/reviews',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,'X-Trace-Token':s.token,...headers},body:JSON.stringify(p)});
 assert.equal((await post(packet,{'X-Trace-Token':'bad'})).status,403);
 assert.equal((await post({...packet,revision:'stale'})).status,409);
 assert.equal((await post({...packet,comments:[{...packet.comments[0],line:999}]})).status,400);
 const response=await post(packet);assert.equal(response.status,202);const {id}=await response.json();let job;
 for(let i=0;i<40;i++){job=await (await fetch(origin+'/api/jobs/'+id)).json();if(job.status!=='running')break;await new Promise(r=>setTimeout(r,50))}
 assert.equal(job.status,'succeeded');assert.match(await readFile(join(dir,'received.txt'),'utf8'),/a.ts:1/);assert.equal(await readFile(join(repo,'a.ts'),'utf8'),'const total = 20;\n');
 }finally{child.kill();await new Promise(r=>child.once('exit',r));await rm(dir,{recursive:true,force:true})}
});
