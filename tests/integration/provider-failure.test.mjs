import test from '../support/test.mjs';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {fixture,root,session,post,eventually,freePort} from '../support/harness.mjs';
for(const reason of ['Provider connection lost','Authentication expired'])test('N-07 optional Codex child failure preserves review: '+reason,async t=>{
 const f=await fixture();t.after(()=>f.dispose());const bin=join(f.dir,'fake-bin');await mkdir(bin);
 await writeFile(join(bin,'codex'),'#!'+process.execPath+'\nprocess.stdin.resume();process.stdin.on("end",()=>{console.error('+JSON.stringify(reason)+');process.exitCode=1;});\n',{mode:0o755});
 const child=spawn(process.execPath,[join(root,'bin/trace.mjs'),'--repo',f.repo,'--agent','codex','--json','--no-open'],{env:{...f.env,PATH:bin+':'+f.env.PATH},stdio:['ignore','pipe','pipe']});
 let text='',stderr='',code;child.stdout.on('data',d=>text+=d);child.stderr.on('data',d=>stderr+=d);const exited=new Promise(ok=>child.once('close',c=>{code=c;ok(c);}));
 t.after(async()=>{child.kill('SIGTERM');await exited;});
 const ready=await eventually(()=>{if(code!==undefined)throw Error(stderr);return text.includes('\n')?JSON.parse(text.split('\n')[0]):null;});const app={url:ready.url},s=await session(app);const response=await post(app,s,undefined,{instruction:'Include shipping'});assert.equal(response.status,202);const job=await response.json();
 const result=await eventually(async()=>{const j=await(await fetch(app.url+'/api/jobs/'+job.id)).json();return j.status==='failed'?j:null;});assert.match(result.output,new RegExp(reason));const saved=(await session(app)).submittedReview;assert.equal(saved.instruction,'Include shipping');assert.equal(saved.replies.length,0);assert.equal(saved.completion,null);
 child.kill('SIGTERM');await exited;await freePort(ready.url);
});

test('Approve releases the viewer port while an optional agent job is still running', async t => {
 const f = await fixture();
 t.after(() => f.dispose());
 const bin = join(f.dir, 'bin');
 await mkdir(bin);
 await writeFile(join(bin, 'codex'), '#!' + process.execPath + '\nsetTimeout(() => {}, 2500);\n', {mode: 0o755});
 const child = spawn(process.execPath, [join(root, 'bin/trace.mjs'), '--repo', f.repo, '--agent', 'codex', '--json', '--no-open'], {
   env: {...f.env, PATH: bin + ':' + f.env.PATH}, stdio: ['ignore', 'pipe', 'ignore']
 });
 t.after(() => child.kill('SIGTERM'));
 let output = '';
 child.stdout.on('data', chunk => { output += chunk; });
 const app = await eventually(() => output.includes('\n') && JSON.parse(output.split('\n')[0]));
 const s = await session(app);
 const response = await post(app, s, '/api/reviews?scope=changes', {instruction: 'Check shipping'});
 assert.equal(response.status, 202);
 const {id} = await response.json();
 const approval = await post(app, s, '/api/reviews?scope=changes', {previousId: id, outcome: 'approved', closeViewer: true});
 assert.equal(approval.status, 201);
 await eventually(() => fetch(app.url).then(() => false, () => true));
 await freePort(app.url);
});
