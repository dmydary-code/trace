import test from '../support/test.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fixture,session,post,comment,eventually,freePort} from '../support/harness.mjs';
import {projects,graphEdges} from '../support/projects.mjs';
import {createTraceServer} from '../../server.mjs';
for(const [index,p] of projects.entries())for(const agent of ['codex','claude']){
 test('HP-'+String(index+1).padStart(2,'0')+' '+p.id+' / '+agent+' — CLI feedback, fix, replies, approval, reopen, port cleanup',{timeout:20000},async t=>{
  const f=await fixture(p.id);t.after(()=>f.dispose());const head=await f.git('rev-parse','HEAD');
  const process=await f.start({sessionId:agent+'-happy'});const app={url:process.ready.url};const s=await session(app);
  assert.equal(s.repositoryPath,f.repo);assert.equal(s.branch,'main');assert.equal(s.base,'HEAD');assert.equal(s.comparison,'working-tree');assert.equal(s.files.length,1);
  const file=s.files[0];assert.equal(file.path,p.path);assert.equal(file.status,'M');
  const added=comment(s,p.path),removed=comment(s,p.path,'del','Keep the shipping parameter.');added.body='Include the supplied shipping fee, not a constant.';
  assert.equal(file.lines[added.index].text,p.after.split('\n')[added.line-1]);
  assert.equal(file.lines[removed.index].text,p.before.split('\n')[removed.line-1]);
  const graph=await(await fetch(app.url+'/api/graph?revision='+s.revision)).json();
  assert(graph.graph.nodes.find(n=>n.path===p.path&&n.changed));assert.equal(graph.graph.sources[p.path],p.after);
  const edges=graph.graph.edges.map(e=>[e.source,e.target,e.kind]).sort();assert.deepEqual(edges,(graphEdges[p.id]||[]).slice().sort());
  const res=await post(app,s,undefined,{comments:[added,removed],instruction:'Include shipping. Preserve unrelated files.'});assert.equal(res.status,201);const saved=await res.json();
  await eventually(()=>process.events.find(e=>e.event==='feedback'));assert.equal(await process.exited,0);
  const feedback=process.events.find(e=>e.event==='feedback');assert.equal(feedback.id,saved.id);assert.equal(feedback.sessionId,process.ready.sessionId);
  assert.deepEqual(feedback.comments.map(c=>[c.id,c.path,c.line,c.side,c.body]),[added,removed].map(c=>[c.id,c.path,c.line,c.side,c.body]));
  assert(feedback.prompt.includes(added.body));assert.equal(JSON.parse((await f.cli('feedback','--review',saved.id,'--json')).stdout).id,saved.id);
  await f.put(p.path,p.fixed);
  for(const c of [added,removed]){
   const body=join(f.dir,c.id+'.txt');await (await import('node:fs/promises')).writeFile(body,'Included the supplied shipping fee. No other files changed.');
   const result=await f.cli('reply','--review',saved.id,'--comment',c.id,'--agent',agent,'--body-file',body,'--json');assert.equal(JSON.parse(result.stdout).commentId,c.id);
  }
  const frozen=await session(app);assert.equal(frozen.revision,s.revision);assert.equal(frozen.submittedReview.replies.length,2);assert(frozen.submittedReview.replies.every(r=>r.author.name===(agent==='codex'?'Codex':'Claude')));
  const current=await(await fetch(app.url+'/api/reviews/'+saved.id+'/current')).json();assert.notEqual(current.revision,s.revision);
  assert(current.files[0].lines.some(l=>l.kind==='add'&&p.fixed.includes(l.text)));assert.equal(await f.read(p.path),p.fixed);
  assert.equal((await post(app,s,'/api/reviews/'+saved.id+'/approve',{revision:s.revision})).status,409);
  const approved=await post(app,s,'/api/reviews/'+saved.id+'/approve',{revision:current.revision});assert.equal(approved.status,200);
  const approval=(await approved.json()).review;assert.equal(approval.completion.outcome,'approved');assert.equal(approval.completion.revision,current.revision);
  assert.equal(await f.git('rev-parse','HEAD'),head);assert.equal(await f.git('remote'), '');
  await process.end();await eventually(()=>fetch(app.url).then(()=>false,()=>true));await freePort(app.url);
  const reopened=await f.server({reviewId:saved.id});const restored=await session(reopened);
  assert.equal(restored.revision,s.revision);assert.deepEqual(restored.files,s.files);assert.equal(restored.submittedReview.replies.length,2);assert.equal(restored.submittedReview.completion.outcome,'approved');
 });
}
