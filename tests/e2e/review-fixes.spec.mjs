import {test,expect,load,addComment,graph,select,send} from './fixtures.mjs';
import {session,eventually,freePort} from '../support/harness.mjs';
test('fix: Enter adds feedback, Shift+Enter keeps a newline, blank text stays unsent',async({page,app})=>{
 await load(page,app);await page.locator('.line.add .comment-trigger').first().click();await page.locator('#comment-body').press('Enter');await expect(page.locator('.file-card .thread')).toHaveCount(0);
 await page.locator('#comment-body').fill('First line');await page.locator('#comment-body').press('Shift+Enter');await page.locator('#comment-body').pressSequentially('Second line');await page.locator('#comment-body').press('Enter');await expect(page.locator('.file-card .thread')).toContainText('First line\nSecond line');await expect(page.locator('.composer')).toHaveCount(0);
});
test('fix: file headers and Viewed stay pinned in Files and Graph detail',async({page,app,f})=>{
 await f.put(f.project.path,f.project.after+'// context\n'.repeat(160));await load(page,app);await page.evaluate(()=>scrollTo(0,700));
 const top=await page.locator('.file-header').boundingBox(),toolbar=await page.locator('main>.toolbar').boundingBox();expect(Math.abs(top.y-toolbar.y-toolbar.height)).toBeLessThan(3);await expect(page.getByLabel('Viewed',{exact:true})).toBeVisible();
 await graph(page);await select(page,'src/pricing.ts');await page.locator('.graph-detail').evaluate(el=>el.scrollTop=700);const detail=await page.locator('.graph-detail').boundingBox(),header=await page.locator('.graph-detail .file-header').boundingBox();expect(Math.abs(header.y-detail.y-45)).toBeLessThan(3);await expect(page.locator('.graph-detail').getByLabel('Viewed',{exact:true})).toBeVisible();
});
test('fix: file cards have exactly the sidebar order, including root files and nested folders',async({page,app,f})=>{
 for(const path of ['src.ts','src-helpers.ts','src/a.ts','src/deep/a.ts','README.md'])await f.put(path,'export const value=1;\n');await load(page,app);
 const sidebar=await page.locator('.file-link').evaluateAll(items=>items.map(el=>el.title));const feed=await page.locator('.file-card .path').allTextContents();expect(feed.map(s=>s.replace('⌘ ','').trim())).toEqual(sidebar);
});
test('fix: declaration card is first, unique, labelled and navigable',async({page,app,f})=>{
 await f.put('src/consumer.ts',"import { total } from './pricing';\nexport const price = total({items: [], shipping: 5});\n");await load(page,app);await page.locator('[data-symbol="total"]').first().click();
 await expect(page.locator('.usage-declaration')).toContainText('export function total');await expect(page.locator('.usage-declaration button')).toHaveCount(1);await expect(page.locator('.usage-results')).not.toContainText('export function total');await page.locator('.usage-declaration button').click();await expect(page.locator('.usage-highlight')).toContainText('export function total');
});
test('fix: comment count and arrows navigate all threads in file order and preserve Viewed',async({page,app,f})=>{
 await f.put('src/another.ts','export const extra=1;\n');await load(page,app);await addComment(page,'First file comment');await page.locator('.file-card').last().locator('.comment-trigger').first().click();await page.locator('#comment-body').fill('Last file comment');await page.locator('#comment-body').press('Enter');
 await expect(page.locator('#comment-position')).toHaveText('2 comments');await page.locator('.file-card').first().getByLabel('Viewed',{exact:true}).check();await page.locator('#next-comment').click();await expect(page.locator('#comment-position')).toHaveText('1 / 2 comments');await expect(page.locator('.comment-current')).toContainText('First file comment');await expect(page.locator('.file-card').first().getByLabel('Viewed',{exact:true})).toBeChecked();
 await page.locator('#next-comment').click();await expect(page.locator('.comment-current')).toContainText('Last file comment');await graph(page);await page.locator('#previous-comment').click();await expect(page.locator('.comment-current')).toContainText('First file comment');await expect(page.locator('#comment-position')).toHaveText('1 / 2 comments');
});
test('fix: sending has a busy state, then a clickable sent state; lost acknowledgement reconciles',async({page,app})=>{
 await load(page,app);await addComment(page,'Feedback');let release;const gate=new Promise(r=>release=r);await page.route('**/api/reviews',async route=>{await gate;await route.fetch();await route.abort();});
 await page.locator('#review').click();await page.locator('#send').click();await expect(page.locator('#review')).toHaveAttribute('aria-busy','true');await expect(page.locator('#review-label')).toHaveText('Sending…');release();await expect(page.locator('#review-label')).toHaveText('Review sent');await expect(page.locator('#review')).toBeEnabled();await expect(page.locator('#review')).toHaveAttribute('aria-busy','false');await expect(page.locator('#handoff')).not.toBeVisible();
 await page.locator('#review').click();await expect(page.locator('#job-state')).toContainText('Review sent');await expect(page.locator('#send')).not.toBeVisible();await page.locator('#close-dialog').click();await page.reload();await expect(page.locator('.file-card .thread')).toContainText('Feedback');
});
test('fix: unbound viewer stays available after Send and reload, then releases its idle port',async({page,f})=>{
 const run=await f.start({lease:false,args:['--viewer-idle-timeout','0.6']}),app={url:run.ready.url};await load(page,app);await addComment(page,'Survive refresh');await send(page);expect(await run.exited).toBe(0);await page.reload();await expect(page.locator('.file-card .thread')).toContainText('Survive refresh');await page.close();await eventually(()=>fetch(app.url).then(()=>false,()=>true),'Idle viewer did not stop');await freePort(app.url);
});
test('fix: imports remain clickable but are absent from usages and match highlights',async({page,app})=>{
 await load(page,app);const imported=page.locator('.line.context [data-symbol="subtotal"]').first();await imported.click();await expect(page.locator('[data-usage-result]')).toHaveCount(1);await expect(page.locator('.usage-results')).not.toContainText('import');await expect(page.locator('.usage-match')).toHaveCount(1);await expect(page.locator('.usage-match')).toContainText('return subtotal');
});
