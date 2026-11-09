import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fixture,session,eventually,freePort} from '../support/harness.mjs';
import {projects} from '../support/projects.mjs';
import {addComment,graph,select,send} from './fixtures.mjs';
for(const [i,p] of projects.entries())for(const agent of ['codex','claude'])test('HP-'+String(i+1).padStart(2,'0')+' browser / '+p.id+' / '+agent,async({page},info)=>{
 const f=await fixture(p.id);try{
  const run=await f.start({sessionId:agent+'-browser'}),app={url:run.ready.url};await page.goto(app.url);await expect(page.locator('.file-card')).toBeVisible();
  await expect(page.locator('#branch')).toContainText('main');await expect(page.locator('#repository-location')).toContainText(f.repo);
  await addComment(page,'Include the supplied shipping fee.');await addComment(page,'Preserve the existing function signature.','del');
  await page.locator('.file-card .thread').filter({hasText:'Include the supplied shipping fee.'}).locator('[data-edit]').click();await page.locator('#comment-body').fill('Include shipping, not a hard-coded constant.');await page.getByRole('button',{name:'Save',exact:true}).click();
  await graph(page);await expect(page.locator('.graph-node:not(.context)')).toHaveCount(1);await select(page,p.path);await expect(page.locator('#graph-file-content')).toContainText(p.after.split('\n').find(l=>l.includes('+ 1'))?.trim()||'');
  await page.locator('#close-graph-file').click();await page.locator('#files-mode').click();await page.locator('#review').click();await page.locator('#instruction').fill('Include shipping and preserve unrelated files.');await page.locator('#send').click();await expect(page.locator('#handoff')).not.toBeVisible();
  await expect(page.locator('#toast')).toContainText('Review sent');await expect(page.locator('.comment-pending:visible')).toHaveCount(2);
  const feedback=await eventually(()=>run.events.find(e=>e.event==='feedback'));expect(await run.exited).toBe(0);expect(feedback.comments[0].body).toBe('Include shipping, not a hard-coded constant.');expect(feedback.comments[1].side).toBe('old');
  await f.put(p.path,p.fixed);const reply=join(f.dir,'body.txt');await writeFile(reply,'Included the supplied shipping fee.');
  for(const c of feedback.comments)await f.cli('reply','--review',feedback.id,'--comment',c.id,'--agent',agent,'--body-file',reply);
  await expect(page.locator('.agent-reply')).toHaveCount(2);await expect(page.locator('.comment-pending:visible')).toHaveCount(0);
  await page.locator('[data-resolve]').first().click();await expect(page.locator('.thread.resolved')).toHaveCount(1);await page.locator('[data-resolve]').first().click();await expect(page.locator('.thread.resolved')).toHaveCount(0);
  const latestResponse=page.waitForResponse(r=>r.url().endsWith('/current')&&r.status()===200);await page.locator('#verify-latest').click();await latestResponse;const changedLine=p.fixed.split('\n').find((line,i)=>line!==p.after.split('\n')[i]);await expect(page.locator('#feed')).toContainText(changedLine.trim());
  await page.locator('#approve-final').click();await expect(page.locator('#review-status-text')).toContainText(/approved|Approval saved/);
  expect(await f.git('log','--format=%s')).toBe('fixture base');await run.end();await eventually(()=>fetch(app.url).then(()=>false,()=>true));await freePort(app.url);
  const reopened=await f.server({reviewId:feedback.id});const restored=await session(reopened);expect(restored.submittedReview.replies).toHaveLength(2);expect(restored.submittedReview.completion.outcome).toBe('approved');
  await info.attach('matrix-result',{body:JSON.stringify({language:p.id,agent,transport:'real CLI, simulated agent action',reviewId:feedback.id}),contentType:'application/json'});
 }finally{await f.dispose();}
});
