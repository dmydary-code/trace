import test from '../support/test.mjs';
import assert from 'node:assert/strict';
import {mkdir,rm,writeFile,chmod,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {fixture,session,post,comment,eventually,freePort} from '../support/harness.mjs';
import {openRepository} from '../../lib/git.mjs';
import {projects} from '../support/projects.mjs';
import {randomUUID} from 'node:crypto';
const setup=async t=>{const f=await fixture();t.after(()=>f.dispose());return f;};
test('D-01/02/05 staged, working-tree, untracked and ignored files are independent',async t=>{
 const f=await setup(t);await f.git('add','.');await f.put(f.project.path,f.project.fixed);await f.put('untracked.js','export const added=1;\n');await f.put('.gitignore','ignored.js\n');await f.put('ignored.js','secret');
 const staged=await(await openRepository(f.repo,{staged:true})).snapshot();assert.equal(staged.files.length,1);assert(staged.files[0].lines.some(l=>l.kind==='add'&&l.text.includes('+ 1;')));
 const working=await(await openRepository(f.repo)).snapshot();assert(working.files.find(f=>f.path==='untracked.js'));assert(!working.files.find(f=>f.path==='ignored.js'));
 await f.git('add','.');await f.git('commit','-m','clean');for(const options of [{},{staged:true}]){const s=await(await openRepository(f.repo,options)).snapshot();assert.equal(s.files.length,0);assert(s.emptyReason.length>10);}
});
test('D-03 branch and merge-base comparisons use distinct explicit bases',async t=>{
 const f=await setup(t);await f.git('checkout','-b','feature');await f.git('add','.');await f.git('commit','-m','feature');await f.git('checkout','main');await f.put('main-only.js','export const mainOnly=1;\n');await f.git('add','.');await f.git('commit','-m','main advances');await f.git('checkout','feature');
 const direct=await(await openRepository(f.repo,{base:'main'})).snapshot(),merged=await(await openRepository(f.repo,{base:'main',mergeBase:true})).snapshot();
 assert(direct.files.find(f=>f.path==='main-only.js'));assert(!merged.files.find(f=>f.path==='main-only.js'));assert.equal(merged.comparison,'merge-base');assert.notEqual(direct.baseRevision,merged.baseRevision);assert.equal(merged.branch,'feature');
});
test('D-04/A-08 worktrees and nested launch paths keep review storage isolated',async t=>{
 const f=await setup(t);const other=join(f.dir,'other');await f.git('worktree','add','-b','another',other);await mkdir(join(other,'nested'));await writeFile(join(other,'src/pricing.js'),f.project.fixed);
 const source=await openRepository(join(other,'nested'));const s=await source.snapshot();assert.equal(s.repositoryPath,other);assert.equal(s.isWorktree,true);assert.equal(s.branch,'another');assert.notEqual(source.gitDir,(await openRepository(f.repo)).gitDir);
 const a=await f.server(),sa=await session(a);const b=await f.server({repo:other}),sb=await session(b);assert.notEqual(sa.repositoryId,sb.repositoryId);assert.notEqual(sa.token,sb.token);
 const review=await post(a,sa,undefined,{instruction:'For main checkout only'});assert.equal(review.status,201);assert.equal((await session(b)).submittedReview,undefined);
});
test('D-06 unborn, detached HEAD and invalid base have explicit results',async t=>{
 const f=await fixture('javascript',{commit:false});t.after(()=>f.dispose());const s=await(await openRepository(f.repo)).snapshot();assert(s.files.length>0);
 await f.git('add','.');await f.git('commit','-m','first');await f.git('checkout','--detach');const detached=await(await openRepository(f.repo)).snapshot();assert.match(detached.branch,/^[a-f0-9]{7}$/);
 await assert.rejects(openRepository(f.repo,{base:'does-not-exist'}),/Cannot resolve base/);
});
test('D-08/10 empty, binary, oversized, modes, CRLF and no-final-newline',async t=>{
 const f=await setup(t);await f.put('empty.txt','');await f.put('large.txt','x'.repeat(1024*1024+1));await writeFile(join(f.repo,'binary.dat'),Buffer.from([0,1,2]));await f.put('crlf.txt','first\r\nlast');await f.git('add','crlf.txt');await f.git('commit','-m','line endings');await f.put('crlf.txt','first\r\nchanged');await chmod(join(f.repo,'src/subtotal.js'),0o755);
 const s=await(await openRepository(f.repo)).snapshot();assert.match(s.files.find(f=>f.path==='empty.txt').note,/Empty/);assert.match(s.files.find(f=>f.path==='large.txt').note,/1 MiB/);assert.match(s.files.find(f=>f.path==='binary.dat').note,/Binary/);
 assert(s.files.find(f=>f.path==='crlf.txt').lines.some(l=>l.kind==='add'&&l.new===2&&l.text==='changed'));assert.match(s.files.find(f=>f.path==='src/subtotal.js').note,/Metadata/);
});
for(const path of ['space name.js','Юникод.js','tab\tname.js','line\nname.js','"quote".js','-leading.js'])test('D-09 literal path '+JSON.stringify(path),async t=>{
 const f=await setup(t);await f.put(path,'export const value=1;\n');const app=await f.server(),s=await session(app);const c=comment(s,path);const res=await post(app,s,undefined,{comments:[c]});assert.equal(res.status,201);assert.equal((await res.json()).review.comments[0].path,path);
});
test('D-11 mixed-language monorepo preserves every changed file',async t=>{
 const f=await setup(t);for(const p of projects)await f.put('packages/'+p.id+'/'+p.path,p.after);const app=await f.server(),s=await session(app);
 for(const p of projects)assert(s.files.some(file=>file.path==='packages/'+p.id+'/'+p.path));
});
for(const outcome of ['approved','cancelled'])test('R-10 '+outcome+' is explicit and never commits',async t=>{
 const f=await setup(t);const run=await f.start({sessionId:outcome});const app={url:run.ready.url},s=await session(app),head=await f.git('rev-parse','HEAD');const res=await post(app,s,undefined,{outcome});assert.equal(res.status,201);assert.equal(await run.exited,outcome==='cancelled'?3:0);assert.equal(run.events.find(e=>e.event==='feedback').outcome,outcome);assert.equal(await f.git('rev-parse','HEAD'),head);await run.end();
});
test('R-03/04/C-02 invalid feedback leaves no partial review; concurrent submissions save once',async t=>{
 const f=await setup(t);const app=await f.server(),s=await session(app),c=comment(s);
 for(const data of [{},{instruction:'   '},{comments:[{...c,index:-1}]},{comments:[c,c]},{instruction:'x'.repeat(10001)},{comments:[{...c,body:'x'.repeat(10001)}]},{outcome:'unknown'}])assert.equal((await post(app,s,undefined,data)).status,400);
 assert.equal((await session(app)).submittedReview,undefined);
 const results=await Promise.all([post(app,s,undefined,{comments:[c]}),post(app,s,undefined,{comments:[c]})]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
 const r=(await session(app)).submittedReview;assert.equal(r.comments.length,1);assert.equal(r.comments[0].id,c.id);
});
test('R-02/07/08/13 concurrent CLI replies validate target and preserve all statuses',async t=>{
 const f=await setup(t);const app=await f.server(),s=await session(app);const res=await post(app,s,undefined,{instruction:'Include shipping'});const review=(await res.json()).review;const body=join(f.dir,'reply.txt');await writeFile(body,'Exact response');
 for(const agent of ['codex','claude'])await Promise.all(['addressed','needs_input','not_changed','note'].map(status=>f.cli('reply','--review',review.id,'--comment','review','--agent',agent,'--status',status,'--body-file',body)));
 const saved=(await session(app)).submittedReview;assert.equal(saved.replies.length,8);assert.deepEqual(new Set(saved.replies.map(r=>r.status)),new Set(['addressed','needs_input','not_changed','note']));
 for(const args of [['--comment',randomUUID(),'--agent','codex'],['--comment','review','--agent','invalid'],['--comment','review','--agent','claude','--status','resolved']])await assert.rejects(f.cli('reply','--review',review.id,...args,'--body-file',body));
 assert.equal((await session(app)).submittedReview.replies.length,8);
});
test('C-01 Host, Origin, token and cross-site boundary reject mutation',async t=>{
 const f=await setup(t);const app=await f.server(),s=await session(app);
 for(const headers of [{Origin:'https://example.invalid'},{'X-Trace-Token':''},{Host:'example.invalid'},{'Sec-Fetch-Site':'cross-site'}]){const http=await import('node:http');const status=await new Promise((ok,fail)=>{const req=http.request(app.url+'/api/reviews',{method:'POST',headers:{Origin:app.url,'X-Trace-Token':s.token,...headers}},res=>{res.resume();ok(res.statusCode);});req.on('error',fail);req.end(JSON.stringify({revision:s.revision,comments:[],instruction:'wrong'}));});assert.equal(status,403,JSON.stringify(headers));}
 assert.equal((await session(app)).submittedReview,undefined);
 const malformed=await fetch(app.url+'/api/reviews',{method:'POST',headers:{Origin:app.url,'X-Trace-Token':s.token},body:'{broken'});assert.equal(malformed.status,400);
 const oversized=await fetch(app.url+'/api/reviews',{method:'POST',headers:{Origin:app.url,'X-Trace-Token':s.token},body:'x'.repeat(200001)});assert.equal(oversized.status,400);
});
test('N-04 accepted review survives loss of HTTP acknowledgement and can be recovered',async t=>{
 const f=await setup(t);const app=await f.server(),s=await session(app);const http=await import('node:http');
 await new Promise((ok,fail)=>{const req=http.request(app.url+'/api/reviews',{method:'POST',headers:{Origin:app.url,'X-Trace-Token':s.token}},res=>{res.destroy();ok();});req.once('error',fail);req.end(JSON.stringify({revision:s.revision,comments:[],instruction:'Include shipping'}));});
 const saved=(await session(app)).submittedReview;assert(saved.id);assert.equal(JSON.parse((await f.cli('feedback','--json')).stdout).id,saved.id);assert.equal((await post(app,s,undefined,{instruction:'retry'})).status,409);
});
