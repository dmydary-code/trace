import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {openRepository} from '../lib/git.mjs';
import {createTraceServer} from '../server.mjs';
import {detectRoutes} from '../lib/detect.mjs';
import {addReply, readReview} from '../lib/reviews.mjs';
import {randomUUID} from 'node:crypto';
const exec = promisify(execFile);
async function fixture(t, commit = true) {
  const repo = await mkdtemp(join(tmpdir(), 'trace-local-'));
  t.after(() => rm(repo, {recursive: true, force: true}));
  const git = (...args) => exec('git', ['-C', repo, ...args]);
  await git('init'); await git('config', 'user.name', 'Trace test'); await git('config', 'user.email', 'test@example.invalid');
  if (commit) { await writeFile(join(repo, 'file.ts'), 'export const count = 1;\n'); await git('add', '.'); await git('commit', '-m', 'fixture'); }
  return {repo, git};
}
test('real Git snapshot includes untracked, deleted, binary, rename and staged changes', async t => {
  const {repo, git} = await fixture(t);
  await writeFile(join(repo, 'delete me.ts'), 'old\n'); await writeFile(join(repo, 'rename.ts'), 'same\n'); await git('add', '.'); await git('commit', '-m', 'more');
  await git('mv', 'rename.ts', 'renamed.ts'); await rm(join(repo, 'delete me.ts'));
  await writeFile(join(repo, 'file.ts'), 'export const count = 2;\n'); await git('add', 'file.ts');
  await writeFile(join(repo, 'file.ts'), 'export const count = 3;\n');
  await writeFile(join(repo, 'new [file].ts'), 'new\n'); await writeFile(join(repo, 'binary.bin'), Buffer.from([1, 0, 2]));
  await symlink('/outside/not-read', join(repo, 'link'));
  const source = await openRepository(join(repo)), snapshot = await source.snapshot();
  assert.equal(snapshot.files.length, 6);
  assert.equal(snapshot.files.find(f => f.path === 'renamed.ts').oldPath, 'rename.ts');
  assert.equal(snapshot.files.find(f => f.path === 'delete me.ts').lines.at(-1).kind, 'del');
  assert.match(snapshot.files.find(f => f.path === 'binary.bin').note, /Binary/);
  assert.equal(snapshot.files.find(f => f.path === 'link').lines[0].text, '/outside/not-read');
  assert.equal(snapshot.files.find(f => f.path === 'new [file].ts').lines[0].new, 1);
  assert.match(snapshot.files.find(f => f.path === 'file.ts').lines.at(-1).text, /3/);
  const staged = await (await openRepository(repo, {staged: true})).snapshot();
  assert.equal(staged.files.length, 2); assert.match(staged.files.find(f => f.path === 'file.ts').lines.at(-1).text, /2/);
  await writeFile(join(repo, 'new [file].ts'), 'changed\n'); assert.notEqual((await source.snapshot()).revision, snapshot.revision);
});
test('unborn repository and paths with tabs/newlines can be reviewed', async t => {
  const {repo, git} = await fixture(t, false);
  const path = 'odd\tline\n.ts'; await writeFile(join(repo, path), '--- header-like content\n'); await git('add', '.');
  const snapshot = await (await openRepository(repo)).snapshot();
  assert.equal(snapshot.files[0].path, path); assert.equal(snapshot.files[0].lines.at(-1).text, '--- header-like content');
});
test('review author follows effective Git identity without exposing email', async t => {
  const {repo, git} = await fixture(t);
  await git('config', 'author.name', 'Repository Author');
  const source = await openRepository(repo);
  assert.deepEqual((await source.snapshot()).author, {name: 'Repository Author'});
  const code = `import {openRepository} from ${JSON.stringify(new URL('../lib/git.mjs', import.meta.url).href)}; console.log(JSON.stringify((await (await openRepository(process.argv[1])).snapshot()).author));`;
  const override = await exec(process.execPath, ['--input-type=module', '-e', code, repo], {env: {...process.env, GIT_AUTHOR_NAME: 'Session Author', GIT_AUTHOR_EMAIL: 'session@example.invalid'}});
  assert.deepEqual(JSON.parse(override.stdout), {name: 'Session Author'});
});
test('framework detection is per package and does not force one stack on a monorepo', async t => {
  const {repo} = await fixture(t);
  for (const [folder, deps] of [['web', {vue: '3'}], ['admin', {'@angular/core': '20'}], ['api', {'@nestjs/core': '11'}], ['react', {react: '19'}]]) {
    await mkdir(join(repo, folder)); await writeFile(join(repo, folder, 'package.json'), JSON.stringify({dependencies: deps}));
  }
  const paths = ['web/src/composables/useCart.ts', 'admin/src/cart.service.ts', 'api/src/cart.service.ts', 'react/src/hooks/useCart.ts', 'README.md'];
  const routes = await detectRoutes(repo, paths.map(path => ({path, lines: []})));
  assert.deepEqual(routes.map(r => r.stack), ['vue', 'angular', 'nestjs', 'react', undefined]);
  assert.deepEqual(routes.slice(0, 4).map(r => r.layer), ['Composables & stores', 'Services & state', 'Implementation', 'Hooks & state']);
  assert.equal(routes[4].layer, 'Other changes');
  const examples = await detectRoutes(repo, [{path: 'README.md', lines: [{text: 'import {Component} from "@angular/core";'}]}, {path: 'analyzer.mjs', lines: [{text: 'const example = "@Component({})";'}]}]);
  assert.ok(examples.every(r => !r.stack));
});
test('feedback persists exact validated anchors and rejects stale/duplicate submissions', async t => {
  const {repo} = await fixture(t); await writeFile(join(repo, 'file.ts'), 'export const count = 2;\n');
  const app = await createTraceServer({repo, wait: true}); t.after(() => app.close());
  const navigationStatus = await new Promise((ok, fail) => { http.get(app.url + '/', {headers: {'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate'}}, res => { res.resume(); ok(res.statusCode); }).on('error', fail); });
  assert.equal(navigationStatus, 200);
  assert.equal((await fetch(app.url + '/api/session', {headers: {'Sec-Fetch-Site': 'cross-site'}})).status, 403);
  const session = await (await fetch(app.url + '/api/session')).json(), f = session.files[0], index = f.lines.findIndex(l => l.kind === 'add');
  const packet = {revision: session.revision, comments: [{id: randomUUID(), path: f.path, index, line: f.lines[index].new, side: 'new', code: 'forged', body: 'Use a named constant'}]};
  const post = (p, headers = {}) => fetch(app.url + '/api/reviews', {method: 'POST', headers: {Origin: app.url, 'X-Trace-Token': session.token, ...headers}, body: JSON.stringify(p)});
  assert.equal((await post(packet, {Origin: 'https://example.invalid'})).status, 403);
  assert.equal((await post({...packet, revision: 'stale'})).status, 409);
  assert.equal((await post({...packet, comments: [{...packet.comments[0], index: -1}]})).status, 400);
  assert.equal((await post({...packet, comments: [packet.comments[0], packet.comments[0]]})).status, 400);
  const received = new Promise(ok => app.events.once('review', ok));
  const response = await post(packet); assert.equal(response.status, 201);
  const result = await received; assert.equal(result.comments[0].id, packet.comments[0].id); assert.equal(result.comments[0].code, 'export const count = 2;');
  assert.equal((await post(packet)).status, 409);
  const persisted = JSON.parse(await readFile(result.reviewPath, 'utf8')); assert.equal(persisted.sessionId, session.sessionId);
  const feedback = await exec(process.execPath, [resolve('bin/trace.mjs'), 'feedback', '--repo', repo, '--json']);
  assert.equal(JSON.parse(feedback.stdout).id, result.id);
});
test('CLI wait completes with feedback in the calling process without running a model', async t => {
  const {repo} = await fixture(t); await writeFile(join(repo, 'file.ts'), 'new\n');
  const child = spawn(process.execPath, [resolve('bin/trace.mjs'), 'review', '--repo', repo, '--wait', '--json', '--no-open'], {stdio: ['ignore', 'pipe', 'pipe']});
  t.after(() => child.kill());
  let output = ''; const events = []; let readyResolve;
  const ready = new Promise(ok => readyResolve = ok);
  child.stdout.on('data', d => { output += d; while (output.includes('\n')) { const split = output.indexOf('\n'), line = output.slice(0, split); output = output.slice(split + 1); const event = JSON.parse(line); events.push(event); if (event.event === 'ready') readyResolve(event); } });
  const done = new Promise((ok, fail) => { child.on('error', fail); child.on('close', ok); });
  const {url, sessionId, viewerPid} = await ready; t.after(() => { try { process.kill(viewerPid); } catch {} }); const session = await (await fetch(url + '/api/session')).json();
  const response = await fetch(url + '/api/reviews', {method: 'POST', headers: {Origin: url, 'X-Trace-Token': session.token}, body: JSON.stringify({revision: session.revision, comments: [], instruction: 'Add a boundary test'})});
  assert.equal(response.status, 201); assert.equal(await done, 0);
  assert.equal(events[1].event, 'feedback'); assert.equal(events[1].sessionId, sessionId); assert.match(events[1].prompt, /boundary test/);
  assert.equal((await fetch(url + '/api/session')).status, 200, 'viewer survives the calling command');
  const replyFile = join(repo, 'reply.txt'); await writeFile(replyFile, 'Added the requested boundary test.');
  await exec(process.execPath, [resolve('bin/trace.mjs'), 'reply', '--repo', repo, '--review', events[1].id, '--comment', 'review', '--agent', 'codex', '--body-file', replyFile, '--json']);
  const persisted = await (await fetch(url + '/api/reviews/' + events[1].id)).json();
  assert.equal(persisted.replies[0].commentId, 'review');
  assert.equal(persisted.replies[0].author.name, 'Codex');
});
test('finish and cancellation are explicit distinct outcomes', async t => {
  for (const outcome of ['approved', 'cancelled']) {
    const {repo} = await fixture(t); const app = await createTraceServer({repo, wait: true});
    try {
      const session = await (await fetch(app.url + '/api/session')).json();
      const received = new Promise(ok => app.events.once('review', ok));
      const response = await fetch(app.url + '/api/reviews', {method: 'POST', headers: {Origin: app.url, 'X-Trace-Token': session.token}, body: JSON.stringify({revision: session.revision, comments: [], outcome})});
      assert.equal(response.status, 201); assert.equal((await received).outcome, outcome);
    } finally { await app.close(); }
  }
});

test('thread replies persist concurrently, validate targets, and retain the reviewed diff after edits', async t => {
  const {repo} = await fixture(t); await writeFile(join(repo, 'file.ts'), 'export const count = 2;\n');
  const app = await createTraceServer({repo}); t.after(() => app.close());
  const session = await (await fetch(app.url + '/api/session')).json(), file = session.files[0];
  const index = file.lines.findIndex(l => l.kind === 'add'), id = randomUUID();
  const response = await fetch(app.url + '/api/reviews', {method: 'POST', headers: {Origin: app.url, 'X-Trace-Token': session.token}, body: JSON.stringify({revision: session.revision, comments: [{id, path: file.path, index, line: file.lines[index].new, side: 'new', body: 'Explain the boundary.'}]})});
  const {review} = await response.json();
  const gitDir = app.repository.gitDir;
  await assert.rejects(addReply(gitDir, {reviewId: review.id, commentId: randomUUID(), agent: 'codex', body: 'wrong'}), /does not belong/);
  await assert.rejects(addReply(gitDir, {reviewId: review.id, commentId: id, agent: 'user', body: 'wrong'}), /agent must/);
  await assert.rejects(addReply(gitDir, {reviewId: review.id, commentId: id, agent: 'codex', body: ' '}), /1–10000/);
  await assert.rejects(addReply(gitDir, {reviewId: review.id, commentId: id, agent: 'codex', body: 'ok', status: 'resolved'}), /Invalid reply status/);
  await Promise.all(Array.from({length: 8}, (_, n) => addReply(gitDir, {reviewId: review.id, commentId: id, agent: n % 2 ? 'claude' : 'codex', body: `Check ${n}`, status: 'note'})));
  assert.equal((await readReview(gitDir, review.id)).replies.length, 8);
  await writeFile(join(repo, 'file.ts'), 'export const count = 999;\n');
  const frozen = await (await fetch(app.url + '/api/session')).json();
  assert.equal(frozen.revision, session.revision);
  assert.equal(frozen.submittedReview.replies.length, 8);
  assert.equal(frozen.files[0].lines[index].text, 'export const count = 2;');
  const reopened = await createTraceServer({repo, reviewId: review.id}); t.after(() => reopened.close());
  const restored = await (await fetch(reopened.url + '/api/session')).json();
  assert.equal(restored.submittedReview.comments[0].id, id);
  assert.equal(restored.submittedReview.replies.length, 8);
  assert.equal(restored.revision, session.revision);
  assert.notEqual(restored.token, frozen.token);
});
test('backend and mobile route signals match the advertised stacks', async t => {
  const {repo} = await fixture(t);
  const cases = [
    ['python', 'requirements.txt', 'fastapi==0.115.0', 'services/cart.py', 'fastapi', 'Implementation'],
    ['jvm', 'pom.xml', '<groupId>org.springframework.boot</groupId>', 'src/CartService.java', 'spring', 'Implementation'],
    ['android', 'build.gradle.kts', 'plugins { id("com.android.application") }', 'src/CartViewModel.kt', 'android', 'Screen state'],
    ['ios', 'Package.swift', 'platforms: [.iOS(.v17)]', 'Sources/CartView.swift', 'ios', 'Screens & navigation'],
    ['flutter', 'pubspec.yaml', 'dependencies:\n  flutter:\n    sdk: flutter', 'lib/cart_repository.dart', 'flutter', 'Data & repositories'],
  ];
  for (const [folder, manifest, body] of cases) { await mkdir(join(repo, folder)); await writeFile(join(repo, folder, manifest), body); }
  const routes = await detectRoutes(repo, cases.map(([folder, , , path]) => ({path: `${folder}/${path}`, lines: []})));
  assert.deepEqual(routes.map(r => [r.stack, r.layer]), cases.map(c => [c[4], c[5]]));
  const swift = await detectRoutes(repo, [{path: 'StandaloneView.swift', lines: [{text: 'import UIKit'}]}]);
  assert.equal(swift[0].stack, 'ios');
});

test('CLI timeout stops its detached viewer without inventing feedback', {timeout: 10000}, async t => {
  const {repo} = await fixture(t);
  const child = spawn(process.execPath, [resolve('bin/trace.mjs'), '--repo', repo, '--wait', '--json', '--no-open', '--timeout', '0.1'], {stdio: ['ignore', 'pipe', 'pipe']});
  let output = ''; child.stdout.on('data', d => output += d);
  t.after(() => child.kill());
  const code = await new Promise((ok, fail) => { child.on('error', fail); child.on('close', ok); });
  assert.equal(code, 2);
  const events = output.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(events.map(e => e.event), ['ready', 'timeout']);
  const {url, viewerPid} = events[0];
  t.after(() => { try { process.kill(viewerPid); } catch {} });
  for (let i = 0; i < 20; i++) {
    const reachable = await fetch(url + '/api/session').then(() => true, () => false);
    if (!reachable) return;
    await new Promise(ok => setTimeout(ok, 25));
  }
  assert.fail('Timed-out viewer remained alive');
});

test('final approval records the inspected revision and preserves original threads', async t => {
  const {repo} = await fixture(t); await writeFile(join(repo, 'file.ts'), 'export const count = 2;\n');
  const app = await createTraceServer({repo}); t.after(() => app.close());
  const session = await (await fetch(app.url + '/api/session')).json();
  const headers = {Origin: app.url, 'X-Trace-Token': session.token};
  const initial = await fetch(app.url + '/api/reviews', {method:'POST',headers,body:JSON.stringify({revision:session.revision,comments:[],instruction:'Adjust the count'})});
  const {id} = await initial.json();
  await writeFile(join(repo,'file.ts'), 'export const count = 3;\n');
  const approve = (revision, extra = {}) => fetch(app.url + `/api/reviews/${id}/approve`, {method:'POST',headers:{...headers,...extra},body:JSON.stringify({revision})});
  assert.equal((await approve(session.revision, {Origin:'https://example.invalid'})).status,403);
  assert.equal((await approve(session.revision)).status,409);
  const latest = await (await fetch(app.url + `/api/reviews/${id}/current`)).json();
  assert.equal(latest.verifying,true); assert.notEqual(latest.revision,session.revision);
  const approved = await approve(latest.revision); assert.equal(approved.status,200);
  const {review} = await approved.json();
  assert.equal(review.outcome,'changes_requested');
  assert.equal(review.completion.outcome,'approved');
  assert.equal(review.completion.revision,latest.revision);
  assert.equal(review.instruction,'Adjust the count');
  assert.equal((await approve(latest.revision)).status,400);
  const restored = await (await fetch(app.url+'/api/session')).json();
  assert.equal(restored.revision,session.revision);
  assert.equal(restored.submittedReview.completion.revision,latest.revision);
  const record = JSON.parse(await readFile(join(app.repository.gitDir,'trace','reviews',id,review.completion.snapshotFile),'utf8'));
  assert.equal(record.revision,latest.revision); assert.equal(record.token,undefined);
});

test('reopening a review retains its baseline after HEAD advances', async t => {
  const {repo,git} = await fixture(t);
  await writeFile(join(repo,'file.ts'),'export const count = 2;\n');
  const original = await createTraceServer({repo}); t.after(() => original.close());
  const session = await (await fetch(original.url+'/api/session')).json();
  const response = await fetch(original.url+'/api/reviews',{method:'POST',headers:{Origin:original.url,'X-Trace-Token':session.token},body:JSON.stringify({revision:session.revision,comments:[],instruction:'Check the count'})});
  const {id} = await response.json();
  await git('add','.'); await git('commit','-m','advance HEAD');
  const reopened = await createTraceServer({repo,reviewId:id}); t.after(() => reopened.close());
  const current = await (await fetch(reopened.url+`/api/reviews/${id}/current`)).json();
  assert.equal(current.files.length,1);
  assert.ok(current.files[0].lines.some(l => l.kind === 'add' && l.text.includes('2')));
});

test('Xcode license failure during submission leaves the review open for retry', async t => {
 const {repo}=await fixture(t);
 await writeFile(join(repo,'file.ts'),'export const count = 2;\n');
 const realGit=(await exec('which',['git'])).stdout.trim();
 const marker=join(repo,'.git','license-blocked'), wrapper=join(repo,'.git','test-git');
 await writeFile(wrapper,`#!${process.execPath}\nconst fs=require('node:fs');if(fs.existsSync(${JSON.stringify(marker)})){console.error('You have not agreed to the Xcode license agreement');process.exit(69);}const r=require('node:child_process').spawnSync(${JSON.stringify(realGit)},process.argv.slice(2),{stdio:'inherit'});process.exit(r.status??1);\n`,{mode:0o755});
 const old=process.env.TRACE_GIT_BIN; process.env.TRACE_GIT_BIN=wrapper;
 let viewer;
 try {
  viewer=await createTraceServer({repo,port:0});
  const s=await (await fetch(viewer.url+'/api/session')).json();
  const f=s.files.find(f=>f.path==='file.ts'),index=f.lines.findIndex(l=>l.kind==='add');
  const packet={revision:s.revision,comments:[{path:f.path,index,line:f.lines[index].new,side:'new',body:'Check the count'}]};
  const post=()=>fetch(viewer.url+'/api/reviews',{method:'POST',headers:{'Content-Type':'application/json',Origin:viewer.url,'X-Trace-Token':s.token},body:JSON.stringify(packet)});
  await writeFile(marker,'blocked');
  const failed=await post(); assert.equal(failed.status,400); assert.match((await failed.json()).error,/Xcode license agreement/);
  await rm(marker);
  const retry=await post(); assert.equal(retry.status,201); assert.equal((await retry.json()).review.comments[0].body,'Check the count');
 } finally { if(viewer) await viewer.close(); if(old===undefined)delete process.env.TRACE_GIT_BIN;else process.env.TRACE_GIT_BIN=old; }
});
