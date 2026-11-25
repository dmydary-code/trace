import {test,expect,load,addComment,graph,select,send} from './fixtures.mjs';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
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
 await load(page,app);await addComment(page,'Feedback');let release;const gate=new Promise(r=>release=r);await page.route('**/api/reviews?*',async route=>{await gate;await route.fetch();await route.abort();});
 await page.locator('#review').click();await page.locator('#send').click();await expect(page.locator('#review')).toHaveAttribute('aria-busy','true');await expect(page.locator('#review-label')).toHaveText('Sending…');await expect(page.locator('#handoff')).toBeVisible();release();await expect(page.locator('#review-label')).toHaveText('Review sent');await expect(page.locator('#review')).toBeEnabled();await expect(page.locator('#review')).toHaveAttribute('aria-busy','false');await expect(page.locator('#handoff')).not.toBeVisible();
 await page.locator('#review').click();await expect(page.locator('#job-state')).toContainText('Review sent');await expect(page.locator('#send')).not.toBeVisible();await page.locator('#close-dialog').click();await page.reload();await expect(page.locator('.file-card .thread')).toContainText('Feedback');
});
test('fix: unbound viewer stays available after Send and reload, then releases its idle port',async({page,f})=>{
 const run=await f.start({lease:false,args:['--once','--viewer-idle-timeout','0.6']}),app={url:run.ready.url};await load(page,app);await addComment(page,'Survive refresh');await send(page);expect(await run.exited).toBe(0);await page.reload();await expect(page.locator('.file-card .thread')).toContainText('Survive refresh');await page.close();await eventually(()=>fetch(app.url).then(()=>false,()=>true),'Idle viewer did not stop');await freePort(app.url);
});
test('fix: imports remain clickable but are absent from usages and match highlights',async({page,app})=>{
 await load(page,app);const imported=page.locator('.line.context [data-symbol="subtotal"]').first();await imported.click();await expect(page.locator('[data-usage-result]')).toHaveCount(1);await expect(page.locator('.usage-results')).not.toContainText('import');await expect(page.locator('.usage-match')).toHaveCount(1);await expect(page.locator('.usage-match')).toContainText('return subtotal');
});

test('header opens an original thread and its reply after the file changes', async ({page, app, f}) => {
 await load(page,app);
 await graph(page); await select(page,'src/pricing.ts');
 await addComment(page,'Please include shipping'); await send(page);
 const {submittedReview} = await session(app);
 const {id} = submittedReview.comments[0];
 const reply = join(f.dir,'reply.txt');
 await writeFile(reply,'Shipping included.');
 await f.cli('reply','--review',submittedReview.id,'--comment',id,'--agent','codex','--body-file',reply);
 await expect(page.locator('.agent-reply')).toContainText('Shipping included.');
 await f.put(f.project.path,f.project.fixed);
 await page.getByRole('button', {name:'Refresh diff'}).click();
 await expect(page.locator('#back-to-threads')).toBeVisible();
 await page.locator('.graph-comment-badge').click();
 await expect(page.locator('.comment-current')).toContainText('Shipping included.');
 await expect(page.locator('#files-mode')).toHaveAttribute('aria-pressed','true');
 await page.locator('header #comment-position').click();
 await expect(page.locator('#comment-links')).toContainText('1 reply');
 await page.locator('#comment-links button').click();
 await expect(page.locator('.comment-current')).toBeInViewport();
 await expect(page.locator('.comment-current')).toBeFocused();
});

test('Approve saves the displayed revision, ends the listener and releases only its port', async ({page, f, app}) => {
 const run = await f.start({args: ['--listen']});
 await load(page, {url: run.ready.url});
 const approve = page.getByRole('button', {name: 'Approve', exact: true});
 await f.put(f.project.path, f.project.fixed);
 await approve.click();
 await expect(page.locator('#toast')).toContainText('Code has changed');
 expect(run.events.filter(event => event.event === 'feedback')).toHaveLength(0);

 await page.locator('#refresh').click();
 await expect(page.locator('.line.add')).toContainText('cart.shipping');
 const revision = (await session({url: run.ready.url})).revision;
 await approve.click();
 await expect(page.getByRole('heading', {name: 'Review approved'})).toBeVisible();
 expect(await run.exited).toBe(0);
 expect(run.events.filter(event => event.event === 'feedback')).toMatchObject([{outcome: 'approved', revision}]);
 const saved = JSON.parse((await f.cli('feedback', '--json')).stdout);
 expect(saved).toMatchObject({outcome: 'approved', revision, sessionId: run.ready.sessionId});
 await freePort(run.ready.url);
 expect((await session(app)).sessionId).toBe(app.sessionId);
});

test('Approve closes a detached viewer after feedback and preserves the original round', async ({page, f}) => {
 const run = await f.start();
 await page.setViewportSize({width: 360, height: 780});
 await load(page, {url: run.ready.url});
 await addComment(page, 'Please review the price.');
 await send(page);
 expect(await run.exited).toBe(0);
 const original = run.events.find(event => event.event === 'feedback');
 await page.getByRole('button', {name: 'Approve', exact: true}).click();
 await expect(page.getByRole('heading', {name: 'Review approved'})).toBeVisible();
 await eventually(() => fetch(run.ready.url).then(() => false, () => true));
 await freePort(run.ready.url);
 await eventually(() => {
   try { process.kill(run.ready.viewerPid, 0); return false; }
   catch (error) { return error.code === 'ESRCH'; }
 }, 'Detached viewer process is still running');
 const approval = JSON.parse((await f.cli('feedback', '--json')).stdout);
 expect(approval).toMatchObject({outcome: 'approved', previousId: original.id});
 const saved = JSON.parse((await f.cli('feedback', '--review', original.id, '--json')).stdout);
 expect(saved.comments[0].body).toBe('Please review the price.');
});

test('Approve queues a single approval while the first empty diff is loading', async ({page, f}) => {
 await f.git('checkout', '--', f.project.path);
 const run = await f.start({args: ['--listen']});
 let release;
 const gate = new Promise(resolve => { release = resolve; });
 await page.route('**/api/session', async route => { await gate; await route.continue(); });
 await page.goto(run.ready.url);
 const approve = page.locator('#approve-review');
 await approve.click();
 await approve.click();
 await expect(approve).toHaveAttribute('aria-busy', 'true');
 release();
 await expect(page.getByRole('heading', {name: 'Review approved'})).toBeVisible();
 expect(await run.exited).toBe(0);
 expect(run.events.filter(e => e.outcome === 'approved')).toHaveLength(1);
});

test('Approve inside the send dialog waits for the pending question to be saved', async ({page, f}) => {
 const run = await f.start({args: []});
 await load(page, {url: run.ready.url});
 await addComment(page, 'Please check shipping.');
 let release;
 const gate = new Promise(resolve => { release = resolve; });
 await page.route('**/api/reviews?*', async route => { await gate; await route.continue(); });
 await page.locator('#review').click();
 await page.locator('#send').click();
 await page.getByRole('dialog').getByRole('button', {name: 'Approve', exact: true}).click();
 release();
 await expect(page.getByRole('heading', {name: 'Review approved'})).toBeVisible();
 expect(await run.exited).toBe(0);
 const feedback = run.events.filter(e => e.event === 'feedback');
 expect(feedback.map(e => e.outcome)).toEqual(['changes_requested', 'approved']);
 expect(feedback[1].previousId).toBe(feedback[0].id);
});

test('a standalone HTML file explains how to open the live review when approving', async ({page}) => {
 await page.goto(new URL('../../dist/index.html', import.meta.url).href);
 await page.locator('#approve-review').click();
 await expect(page.locator('#approve-help')).toBeVisible();
 await expect(page.locator('#approve-help')).toContainText('trace-review');
 await expect(page.getByRole('heading', {name: 'Review approved'})).toHaveCount(0);
});

test('Approve works on a commit and again when reopening its saved approval', async ({page, f}) => {
 await f.git('add', f.project.path);
 await f.git('commit', '-m', 'Adjust shipping');
 const sha = await f.git('rev-parse', 'HEAD');
 const original = await f.server();
 await page.goto(original.url + '?scope=' + sha);
 await expect(page.locator('#title')).toHaveText('Adjust shipping');
 await page.locator('#approve-review').click();
 await expect(page.getByRole('heading', {name: 'Review approved'})).toBeVisible();
 const saved = JSON.parse((await f.cli('feedback', '--json')).stdout);
 expect(saved.scope).toBe(sha);
 const reopened = await f.server({reviewId: saved.id});
 await page.goto(reopened.url);
 await expect(page.locator('#title')).toHaveText('Adjust shipping');
 await page.locator('#approve-review').click();
 await expect(page.getByRole('heading', {name: 'Review approved'})).toBeVisible();
 expect(JSON.parse((await f.cli('feedback', '--json')).stdout).previousId).toBe(saved.id);
});

test('Approve in a pending thread preserves an unsent reply when the reviewer cancels', async ({page, app}) => {
 await load(page, app);
 await addComment(page, 'Does the price include shipping?');
 await send(page);
 await page.locator('[data-followup]').click();
 const dialog = page.getByRole('form', {name: 'Reply in thread'});
 const reply = dialog.getByRole('textbox');
 await reply.fill('Here is one more question.');
 const approve = page.locator('header #approve-review');
 page.once('dialog', prompt => prompt.dismiss());
 await approve.click();
 await expect(reply).toHaveValue('Here is one more question.');
 page.once('dialog', prompt => prompt.accept());
 await approve.click();
 await expect(page.getByRole('heading', {name: 'Review approved'})).toBeVisible();
});

test('more line comments can be drafted and sent after an agent replies', async ({page, app, f}) => {
  await load(page, app);
  await addComment(page, 'Check the shipping fee.');
  await send(page);
  const first = (await session(app)).submittedReview;
  const body = join(f.dir, 'agent-reply.txt');
  await writeFile(body, 'Shipping is now included.');
  await f.put(f.project.path, f.project.fixed);
  await f.cli('reply', '--review', first.id, '--comment', first.comments[0].id,
    '--body-file', body, '--agent', 'codex');
  await expect(page.locator('.agent-reply')).toContainText('Shipping is now included.');

  await addComment(page, 'Check the previous calculation too.');
  await expect(page.locator('.file-card .thread')).toHaveCount(2);
  await expect(page.locator('.agent-reply')).toBeVisible();
  await page.reload();
  await expect(page.locator('.file-card .thread')).toHaveCount(2);
  await page.locator('#review').click();
  await expect(page.locator('#review-list')).toContainText('Check the previous calculation too.');
  await expect(page.locator('#review-list')).not.toContainText('Check the shipping fee.');
  await page.locator('#send').click();
  await expect(page.locator('#handoff')).not.toBeVisible();
  const second = (await session(app)).submittedReview;
  expect(second).toMatchObject({previousId:first.id, revision:first.revision, sessionId:first.sessionId});
  expect(second.comments.map(c => c.body)).toEqual(['Check the previous calculation too.']);
  expect(second.comments[0].code).toBe(first.comments[0].code);

  await page.locator('#comment-position').click();
  await page.locator('#comment-links').getByRole('button', {name:/Check the shipping fee/}).click();
  await expect(page.locator('.agent-reply')).toContainText('Shipping is now included.');
  await expect(page.locator('.file-card .thread')).toHaveCount(1);
  await expect(page.locator('.line.add .comment-trigger').first()).toBeEnabled();
});

test('Send now delivers one comment, keeps other drafts and links back to answered threads', async ({page, app, f}) => {
  await load(page, app);
  await addComment(page, 'Send this comment now.');
  await addComment(page, 'Keep this comment in the draft.');
  const immediate = page.locator('.file-card .thread').filter({hasText:'Send this comment now.'});
  await page.route('**/api/reviews?*', async route => { await route.fetch(); await route.abort(); }, {times:1});
  await immediate.getByRole('button', {name:'Send now', exact:true}).click();
  await expect(immediate.getByRole('button', {name:'Reply', exact:true})).toBeVisible();
  const first = (await session(app)).submittedReview;
  expect(first.comments.map(c => c.body)).toEqual(['Send this comment now.']);

  await page.reload();
  await expect(page.locator('.file-card .thread').filter({hasText:'Keep this comment in the draft.'})).toContainText('Draft');
  const replyPath = join(f.dir, 'immediate-reply.txt');
  await writeFile(replyPath, 'This is the agent’s answer.');
  await f.cli('reply', '--review', first.id, '--comment', first.comments[0].id, '--body-file', replyPath, '--agent', 'codex');
  const reply = immediate.locator('.agent-reply');
  await expect(reply).toBeVisible();
  const indent = await reply.evaluate(el => el.getBoundingClientRect().left - el.closest('.thread').querySelector('.reviewer-message').getBoundingClientRect().left);
  expect(indent).toBeGreaterThanOrEqual(10);

  await send(page);
  expect((await session(app)).submittedReview.comments.map(c => c.body)).toEqual(['Keep this comment in the draft.']);
  await page.getByRole('button', {name:'Open comments in ' + first.comments[0].path}).click();
  await expect(immediate).toBeFocused();
  await expect(reply).toContainText('This is the agent’s answer.');
});

test('diff arrows reveal all unchanged lines without moving comment anchors', async ({page, f}) => {
  const path = 'context.txt';
  const original = Array.from({length:64}, (_, i) => `Original line ${i + 1}`);
  const updated = [...original];
  updated[16] = 'First edited line';
  updated[44] = 'Second edited line';
  await f.put(path, original.join('\n') + '\n');
  await f.git('add', path);
  await f.git('commit', '-m', 'Add context fixture');
  await f.put(path, updated.join('\n') + '\n');
  const app = await f.server({wait:true});
  await load(page, app);
  const card = page.locator('.file-card').filter({has:page.getByText('⌘ ' + path, {exact:true})});
  const gaps = card.getByRole('button', {name:/^Show .*unchanged lines$/});
  await expect(gaps).toHaveCount(3);
  for (let expanded = 0; expanded < 3; expanded++) {
    await gaps.first().click();
    await expect(card.getByRole('button', {name:'Hide unchanged lines'})).toHaveCount(expanded + 1);
  }
  await expect(card.locator('.line:not(.del) code')).toHaveText(updated);
  await card.getByRole('button', {name:'Comment on context.txt new line 17', exact:true}).click();
  await page.locator('#comment-body').fill('Review this changed line.');
  await page.getByRole('button', {name:'Add to review', exact:true}).click();
  await send(page);
  expect((await session(app)).submittedReview.comments[0]).toMatchObject({path, line:17, code:updated[16]});
  await f.put(path, 'The working copy now differs.\n');
  await page.reload();
  await gaps.first().click();
  await expect(card.locator('.expanded-context').first()).toContainText(original[0]);
});

test('inline thread keeps late replies in order and preserves a draft in Graph', async ({page, app, f}) => {
  await load(page, app);
  await graph(page);
  await select(page, f.project.path);
  const thread = page.locator('#graph-file-content .thread');
  const messages = thread.locator('.comment-bubble > p');
  const reply = thread.getByRole('textbox', {name:'Reply'});
  const first = 'How is the fee calculated?';
  const second = 'Does the amount include tax?';
  const third = 'Please document the tax rule.';
  const answer = 'The fee uses the subtotal.';

  await addComment(page, first);
  await send(page);
  const {submittedReview} = await session(app);
  await thread.getByRole('button', {name:'Reply', exact:true}).click();
  await reply.fill(second);
  await thread.getByRole('button', {name:'Send reply'}).click();
  await expect(messages).toHaveText([first, second]);
  await expect(thread.locator('.reviewer-message').nth(1)).toHaveClass(/thread-reply/);
  await expect(thread.locator('.reviewer-message').first()).not.toHaveClass(/thread-reply/);

  await thread.getByRole('button', {name:'Reply', exact:true}).click();
  await reply.fill(third);
  await reply.evaluate(el => el.setSelectionRange(3, 9));
  const body = join(f.dir, 'agent-reply.txt');
  await writeFile(body, answer);
  await f.cli('reply', '--review', submittedReview.id, '--comment', submittedReview.comments[0].id,
    '--body-file', body, '--agent', 'claude', '--status', 'note');
  await expect(messages).toHaveText([first, second, answer]);
  await expect(thread.locator('.agent-reply .author-name')).toHaveText('Claude');
  await expect(reply).toBeFocused();
  const accent = () => thread.locator('.agent-reply .author-name').evaluate(el => getComputedStyle(el).color);
  await expect(reply).toHaveCSS('outline-color', await accent());
  await expect(reply).toHaveValue(third);
  expect(await reply.evaluate(el => [el.selectionStart, el.selectionEnd])).toEqual([3, 9]);

  await thread.getByRole('button', {name:'Cancel'}).click();
  await page.getByRole('button', {name:'Appearance', exact:true}).click();
  await page.getByLabel('Color scheme').selectOption('light');
  await page.keyboard.press('Escape');
  await thread.getByRole('button', {name:'Reply', exact:true}).click();
  await expect(reply).toHaveValue(third);
  await expect(reply).toHaveCSS('outline-color', await accent());
  await thread.getByRole('button', {name:'Send reply'}).click();
  await expect(messages).toHaveText([first, second, answer, third]);
  const current = (await session(app)).submittedReview;
  const history = [first, second, answer];
  expect(current.thread.map(m => m.body)).toEqual(history);
  expect(current.prompt).toContain('Prior conversation: ' + JSON.stringify(current.thread));
  await page.reload();
  await select(page, f.project.path);
  await expect(messages).toHaveText([...history, third]);
});
