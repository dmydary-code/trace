import {test,expect,load,addComment,graph,send,select} from './fixtures.mjs';
import {session,post} from '../support/harness.mjs';
test('N-01 loading precedes valid diff and valid empty state',async({page,app})=>{
 let release;const gate=new Promise(r=>release=r);await page.route('**/api/session',async route=>{await gate;await route.continue();});
 try{await page.goto(app.url);await expect(page.locator('#feed')).toContainText('Loading diff');await expect(page.locator('#feed')).not.toContainText('No changes');}finally{release();}
 await expect(page.locator('.file-card')).toBeVisible();
});
test('D-05/N-01 clean repository shows empty reason only after loading',async({page,app,f})=>{
 await f.git('reset','--hard','HEAD');await page.goto(app.url);await expect(page.locator('#feed')).toContainText('No changes against');await expect(page.locator('#feed')).toContainText(f.repo);await expect(page.locator('.file-card')).toHaveCount(0);
});
test('N-02 initial connection failure gives error and retry recovers',async({page,app})=>{
 await page.route('**/api/session',route=>route.abort());await page.goto(app.url);await expect(page.locator('#feed')).toContainText('Start');await expect(page.locator('#feed')).not.toContainText('No changes to display');await page.unroute('**/api/session');await page.reload();await expect(page.locator('.file-card')).toBeVisible();
});
test('D-12/N-03 stale submission retains feedback and reports failure',async({page,app,f})=>{
 await load(page,app);await addComment(page,'Keep my feedback');await f.put(f.project.path,f.project.fixed);await page.locator('#review').click();await page.locator('#send').click();await expect(page.locator('#handoff')).toBeVisible();await expect(page.locator('#review-list')).toContainText('Keep my feedback');await expect(page.locator('#toast')).toContainText('not sent');expect((await session(app)).submittedReview).toBeUndefined();
});
test('N-03 network failure before persistence preserves comment and allows retry',async({page,app})=>{
 await load(page,app);await addComment(page,'Retry safely');await page.route('**/api/reviews',route=>route.abort());await page.locator('#review').click();await page.locator('#send').click();await expect(page.locator('#handoff')).toBeVisible();await expect(page.locator('#review-list')).toContainText('Retry safely');expect((await session(app)).submittedReview).toBeUndefined();await page.unroute('**/api/reviews');await page.locator('#send').click();await expect(page.locator('#handoff')).not.toBeVisible();await expect(page.locator('#review-status-text')).toContainText('Review submitted');expect((await session(app)).submittedReview.comments).toHaveLength(1);
});
test('N-04 lost acknowledgement can be recovered by reload without duplicate saved review',async({page,app})=>{
 await load(page,app);await addComment(page,'Persist once');await page.route('**/api/reviews',async route=>{await route.fetch();await route.abort();});await page.locator('#review').click();await page.locator('#send').click();await expect(page.locator('#review-label')).toHaveText('Review sent');await expect(page.locator('#handoff')).not.toBeVisible();const saved=(await session(app)).submittedReview;expect(saved.comments).toHaveLength(1);await page.unroute('**/api/reviews');await page.reload();await expect(page.locator('.comment-pending:visible')).toHaveCount(1);expect((await session(app)).submittedReview.id).toBe(saved.id);
});
test('N-06 Graph failure and retry leave Files usable',async({page,app})=>{
 await load(page,app);await page.route('**/api/graph?*',route=>route.fulfill({status:500,json:{error:'Injected graph outage'}}));await page.locator('#route-mode').click();await expect(page.locator('#feed')).toContainText('Injected graph outage');await page.locator('#files-mode').click();await expect(page.locator('.file-card')).toBeVisible();await page.unroute('**/api/graph?*');await page.locator('#route-mode').click();await page.locator('#retry-graph').click();await expect(page.locator('.graph-svg')).toBeVisible();
});
test('N-01/G-16 delayed old Graph result cannot overwrite refreshed diff',async({page,app,f})=>{
 await load(page,app);let release;const gate=new Promise(r=>release=r);let captured=false;
 await page.route('**/api/graph?*',async route=>{const res=await route.fetch();if(!captured){captured=true;await gate;}await route.fulfill({response:res});});
 await page.locator('#route-mode').click();await expect(page.locator('#feed')).toContainText('Building Graph');await page.locator('#files-mode').click();await f.put('src/new.ts','export const fresh=1;\n');await page.locator('#refresh').click();await expect(page.locator('.file-card')).toHaveCount(2);release();await page.locator('#route-mode').click();await expect(page.getByRole('button',{name:'Select src/new.ts',exact:true})).toBeVisible();
});
test('N-08 public internet outage does not break local review assets or Graph',async({page,app})=>{
 const external=[];await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==app.url){external.push(url.origin);return route.abort();}return route.continue();});await load(page,app);await graph(page);await select(page,'src/pricing.ts');await addComment(page,'Works without public internet');await send(page);await expect(page.locator('.file-card .thread')).toContainText('Works without public internet');expect(external).toEqual([]);
});
test('D-14 unchanged latest diff gives explanation; a real edit updates the patch',async({page,app,f})=>{
 await load(page,app);await addComment(page,'Check shipping');await send(page);await page.locator('#verify-latest').click();await expect(page.locator('#toast')).toContainText('latest changes');await page.locator('#verify-latest').click();await expect(page.locator('#toast')).toContainText('No new changes');await f.put(f.project.path,f.project.fixed);await page.locator('#verify-latest').click();await expect(page.locator('#feed')).toContainText('+ cart.shipping');
});
