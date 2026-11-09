import {test,expect,load,addComment,graph,select,send} from './fixtures.mjs';
import {session,post} from '../support/harness.mjs';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
test('UI-01/UI-G-07 Viewed collapses Files, hides Graph nodes and resets both',async({page,app})=>{
 await load(page,app);await addComment(page,'Keep this feedback');await page.getByLabel('Viewed',{exact:true}).check();await expect(page.locator('.file-card')).toHaveClass(/viewed-collapsed/);await expect(page.locator('.diff')).not.toBeVisible();
 await graph(page);await expect(page.locator('.graph-node:not(.context)')).toHaveCount(0);await page.locator('#reset-viewed').click();await expect(page.locator('.graph-node:not(.context)')).toHaveCount(1);await page.locator('#files-mode').click();await expect(page.locator('.diff')).toBeVisible();await expect(page.locator('.file-card .thread')).toContainText('Keep this feedback');
});
test('UI-02/03 sidebar, theme, search and sticky toolbar persist without changing comments',async({page,app,f})=>{
 await f.put('src/another.ts','export const another=1;\n'+'// long review fixture\n'.repeat(100));await load(page,app);await addComment(page,'Persistent feedback');await page.locator('#theme').click();const theme=await page.locator('html').getAttribute('data-theme');await page.locator('#sidebar-resizer').press('ArrowRight');const width=await page.locator('#sidebar-resizer').getAttribute('aria-valuenow');
 await page.getByLabel('Find a file').fill('pricing');await expect(page.locator('.file-card')).toHaveCount(1);await page.getByLabel('Find a file').fill('');await expect(page.locator('.file-card')).toHaveCount(2);await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme',theme);await expect(page.locator('#sidebar-resizer')).toHaveAttribute('aria-valuenow',width);await expect(page.locator('.file-card .thread')).toContainText('Persistent feedback');
 await page.locator('#toggle-sidebar').click();await expect(page.locator('body')).toHaveClass(/sidebar-collapsed/);await page.evaluate(()=>window.scrollTo(0,400));await expect.poll(()=>page.locator('main>.toolbar').evaluate(el=>el.getBoundingClientRect().top)).toBeLessThan(75);expect(await page.locator('main>.toolbar').evaluate(el=>el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(65);
});
test('UI-04/05/07 Find Usages matches same-side identifiers, highlights and navigates',async({page,app})=>{
 await load(page,app);const symbol=page.locator('.line.add .diff-symbol[data-symbol="subtotal"]').first();await expect(symbol).toHaveCSS('cursor','pointer');await symbol.click();await expect(page.locator('#diff-usages')).toBeVisible();await expect(page.locator('.usage-match')).toHaveCount(1);await expect(page.locator('.usage-token-match')).toHaveCount(1);
 const result=page.locator('[data-usage-result]').last();await result.click();await expect(page.locator('.usage-highlight')).toBeVisible();await page.locator('[data-close-usages]').click();await expect(page.locator('.usage-token-match')).toHaveCount(0);
 await symbol.click({modifiers:['Meta']});await expect(page.locator('#diff-usages')).toBeVisible();await page.keyboard.press('Escape');await symbol.focus();await page.keyboard.press('Alt+F7');await expect(page.locator('#diff-usages')).toBeVisible();
 const colors=await page.locator('[data-usage-result]').first().evaluate(el=>[getComputedStyle(el.querySelector('strong')).color,getComputedStyle(el.querySelector('code')).color]);expect(colors[0]).not.toBe(colors[1]);
});
test('UI-G-01/02/03 context selection keeps nodes linked and stable; previews update immediately',async({page,app,f})=>{
 await f.put('src/second.ts',"import { subtotal } from './subtotal';\nexport const second = subtotal([]);\n");await load(page,app);await graph(page);const pricing=page.getByRole('button',{name:'Select src/pricing.ts',exact:true});const original=await pricing.getAttribute('transform');await select(page,'src/pricing.ts');await expect(page.locator('#graph-file-content')).toContainText('total');await expect(pricing).toHaveAttribute('transform',original);
 await select(page,'src/second.ts');await expect(page.locator('#graph-file-content')).toContainText('second');await select(page,'src/subtotal.ts');await expect(page.locator('#graph-preview-label')).toBeVisible();await expect(page.locator('#graph-file-content')).toContainText('reduce');await expect(page.getByRole('button',{name:'Select src/pricing.ts',exact:true})).toHaveCount(1);expect(await page.locator('.graph-edge').count()).toBeGreaterThan(0);
});
test('UI-G-04/05/06 drag, zoom, resize and Reset graph preserve feedback and Viewed state',async({page,app})=>{
 await load(page,app);await addComment(page,'A comment');await graph(page);await select(page,'src/pricing.ts');await page.locator('#graph-zoom-in').click();await expect(page.locator('#graph-zoom-value')).toHaveText('120%');const node=page.getByRole('button',{name:'Select src/pricing.ts',exact:true}),original=await node.getAttribute('transform');
 const box=await node.boundingBox();await page.mouse.move(box.x+60,box.y+20);await page.mouse.down();await page.mouse.move(box.x+100,box.y+60,{steps:6});await page.mouse.up();await expect(node).not.toHaveAttribute('transform',original);
 const width=await page.locator('#graph-file-content').evaluate(el=>el.getBoundingClientRect().width);await page.locator('#graph-detail-resizer').press('ArrowLeft');expect(await page.locator('#graph-file-content').evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThan(width);await expect(page.locator('#graph-zoom-value')).toHaveText('120%');
 await page.locator('.graph-viewport').dispatchEvent('wheel',{ctrlKey:true,deltaY:-1000,clientX:200,clientY:500});await expect(page.locator('#graph-zoom-value')).toHaveText('300%');await page.locator('.graph-viewport').dispatchEvent('wheel',{ctrlKey:true,deltaY:1000,clientX:200,clientY:500});await expect(page.locator('#graph-zoom-value')).toHaveText('25%');
 await page.locator('#reset-graph').click();await expect(page.locator('#graph-zoom-value')).toHaveText('100%');await expect(node).toHaveAttribute('transform',original);await expect(page.locator('#graph-file-content')).toHaveCount(0);await expect(page.locator('.graph-node.context')).toHaveCount(0);await expect(page.locator('.graph-comment-badge')).toHaveAttribute('aria-label','1 comments');await page.locator('#files-mode').click();await expect(page.locator('.file-card .thread')).toContainText('A comment');
});
test('UI-G-08 comment badge counts retained comments, not replies or resolution state',async({page,app})=>{
 await load(page,app);await addComment(page,'First');await addComment(page,'Second','del');await graph(page);await expect(page.locator('.graph-comment-badge')).toHaveAttribute('aria-label','2 comments');await select(page,'src/pricing.ts');await page.locator('[data-resolve]').first().click();await expect(page.locator('.graph-comment-badge')).toHaveAttribute('aria-label','2 comments');await page.locator('[data-delete]').first().click();await expect(page.locator('.graph-comment-badge')).toHaveAttribute('aria-label','1 comments');
});
test('D-07/UI-G-02 deleted node opens previous source with a close icon',async({page,app,f})=>{
 await (await import('node:fs/promises')).rm(join(f.repo,'src/subtotal.ts'));await load(page,app);await graph(page);await select(page,'src/subtotal.ts');await expect(page.locator('#graph-file-content')).toContainText('Previous version');await expect(page.locator('#graph-file-content')).toContainText('reduce');await expect(page.getByRole('button',{name:'Close file',exact:true})).toHaveText('×');
});
test('R-14 same-origin draft survives reload; R-09 Resolve/Reopen is reviewer-controlled',async({page,app})=>{
 await load(page,app);await addComment(page,'Persistent');await page.reload();await expect(page.locator('.file-card .thread')).toContainText('Persistent');await page.locator('[data-resolve]').click();await expect(page.locator('.file-card .thread')).toHaveClass(/resolved/);await page.locator('[data-resolve]').click();await expect(page.locator('.file-card .thread')).not.toHaveClass(/resolved/);
});
test('R-05/06/08/N-05 delayed reply and lost polling recover with accurate Pending',async({page,app,f})=>{
 await load(page,app);await addComment(page,'Include shipping');await send(page);await expect(page.locator('.comment-pending:visible')).toHaveCount(1);const s=await session(app),review=s.submittedReview;
 await page.route('**/api/reviews/'+review.id,route=>route.abort());await expect(page.locator('#reply-connection')).toContainText('disconnected');await expect(page.locator('.file-card .thread')).toContainText('Include shipping');
 const body=join(f.dir,'reply.txt');await writeFile(body,'Need input about shipping currency.');await f.cli('reply','--review',review.id,'--comment',review.comments[0].id,'--agent','claude','--status','needs_input','--body-file',body);await page.unroute('**/api/reviews/'+review.id);
 await expect(page.locator('.agent-reply')).toContainText('Need input');await expect(page.locator('.comment-pending:visible')).toHaveCount(0);await expect(page.locator('.file-card .thread')).not.toHaveClass(/resolved/);await expect(page.locator('.agent-reply')).toHaveCount(1);
});
test('C-03/UI-08 source, path and feedback HTML are text; browser modules load without errors',async({page,app,f})=>{
 await f.put('src/<img onerror=alert(1)>.ts','export const html = "<img src=x onerror=alert(1)>";\n');const errors=[];page.on('pageerror',e=>errors.push(e.message));let dialog=false;page.on('dialog',async d=>{dialog=true;await d.dismiss();});await load(page,app);await addComment(page,'<img src=x onerror=alert(1)>');await expect(page.locator('.file-card .thread')).toContainText('<img');expect(dialog).toBe(false);expect(await page.locator('.file-card .thread img').count()).toBe(0);expect(errors).toEqual([]);
 for(const module of ['/app.js','/core.mjs','/usages.mjs','/graph-layout.mjs']){const res=await page.request.get(app.url+module);expect(res.status()).toBe(200);expect(res.headers()['content-type']).toContain('javascript');expect(res.headers()['content-security-policy']).toContain("script-src 'self'");}
});
test('UI-G-09 separate relation lanes, non-overlapping nodes and inspectable cycles',async({page,app,f})=>{
 await f.put('src/a.ts',"import { b } from './b';\nexport function a() { b(); }\n");await f.put('src/b.ts',"import { a } from './a';\nexport function b() { return a; }\n");await load(page,app);await graph(page);await select(page,'src/a.ts');
 const shapes=await page.locator('.graph-node').evaluateAll(nodes=>nodes.map(n=>{const m=n.transform.baseVal.consolidate().matrix;return {path:n.dataset.node,x:m.e,y:m.f,width:230,height:48};}));
 for(let i=0;i<shapes.length;i++)for(let j=i+1;j<shapes.length;j++){const a=shapes[i],b=shapes[j];expect(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y).toBe(true);}
 const paths=await page.locator('.graph-edge path').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('d')));expect(new Set(paths).size).toBe(paths.length);await expect(page.locator('.graph-connections')).toContainText('src/b.ts');
 const kinds=await page.locator('.graph-edge path').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('stroke-dasharray')));expect(kinds).toContain(null);expect(kinds).toContain('7 4');
 const routes=await page.locator('.graph-edge').evaluateAll(groups=>groups.map(g=>({d:g.querySelector('path').getAttribute('d'),ends:g.querySelector('title').textContent.split(' · ')[1].split(' → ')})));
 for(const route of routes){const [x,y,lane,ty,tx]=route.d.match(/-?\d+(?:\.\d+)?/g).map(Number);const segments=[[x,y,lane,y],[lane,y,lane,ty],[lane,ty,tx,ty]];
  for(const node of shapes.filter(n=>!route.ends.includes(n.path)))for(const [ax,ay,bx,by] of segments){const horizontal=ay===by;const crosses=horizontal?ay>node.y+1&&ay<node.y+47&&Math.max(ax,bx)>node.x+1&&Math.min(ax,bx)<node.x+229:ax>node.x+1&&ax<node.x+229&&Math.max(ay,by)>node.y+1&&Math.min(ay,by)<node.y+47;expect(crosses,'Edge crosses unrelated node '+node.path).toBe(false);}
 }

});
test('UI-G-05 WebKit gesture events preserve graph zoom bounds',async({page,app})=>{
 await load(page,app);await graph(page);const canvas=page.locator('.graph-viewport');
 await canvas.evaluate(el=>{for(const [type,scale] of [['gesturestart',1],['gesturechange',2],['gestureend',2]]){const event=new Event(type,{bubbles:true,cancelable:true});for(const [key,value] of Object.entries({scale,clientX:500,clientY:500}))Object.defineProperty(event,key,{value});el.dispatchEvent(event);}});await expect(page.locator('#graph-zoom-value')).toHaveText('200%');
 await page.locator('#graph-zoom-out').click();await expect(page.locator('#graph-zoom-value')).toHaveText('167%');
});
test('R-01 add/edit/delete comments on all diff line sides before submitting',async({page,app})=>{
 await load(page,app);await addComment(page,'Added line comment');await addComment(page,'Removed line comment','del');await addComment(page,'Context line comment','context');
 const removed=page.locator('.file-card .thread').filter({hasText:'Removed line comment'});await removed.locator('[data-edit]').click();await page.locator('#comment-body').fill('Edited removed-line feedback');await page.getByRole('button',{name:'Save',exact:true}).click();
 await page.locator('.file-card .thread').filter({hasText:'Added line comment'}).locator('[data-delete]').click();await send(page);const saved=(await session(app)).submittedReview;expect(saved.comments.map(c=>c.body).sort()).toEqual(['Context line comment','Edited removed-line feedback']);expect(saved.comments.map(c=>c.side).sort()).toEqual(['new','old']);
});
test('L-11 browser tab closure leaves the owning session alive and saved threads reopen',async({page,context,f})=>{
 const run=await f.start({sessionId:'tab-close'}),app={url:run.ready.url};await load(page,app);await addComment(page,'Survive tab closure');await send(page);await page.close();expect((await fetch(app.url)).status).toBe(200);
 const reopened=await context.newPage();await reopened.goto(app.url);await expect(reopened.locator('.file-card .thread')).toContainText('Survive tab closure');await run.end();
});
