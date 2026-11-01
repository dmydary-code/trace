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
  const packet = {revision: session.revision, comments: [{path: f.path, index, line: f.lines[index].new, side: 'new', code: 'forged', body: 'Use a named constant'}]};
  const post = (p, headers = {}) => fetch(app.url + '/api/reviews', {method: 'POST', headers: {Origin: app.url, 'X-Trace-Token': session.token, ...headers}, body: JSON.stringify(p)});
  assert.equal((await post(packet, {Origin: 'https://example.invalid'})).status, 403);
  assert.equal((await post({...packet, revision: 'stale'})).status, 409);
  assert.equal((await post({...packet, comments: [{...packet.comments[0], index: -1}]})).status, 400);
  const received = new Promise(ok => app.events.once('review', ok));
  const response = await post(packet); assert.equal(response.status, 201);
  const result = await received; assert.equal(result.comments[0].code, 'export const count = 2;');
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
  const {url, sessionId} = await ready; const session = await (await fetch(url + '/api/session')).json();
  const response = await fetch(url + '/api/reviews', {method: 'POST', headers: {Origin: url, 'X-Trace-Token': session.token}, body: JSON.stringify({revision: session.revision, comments: [], instruction: 'Add a boundary test'})});
  assert.equal(response.status, 201); assert.equal(await done, 0);
  assert.equal(events[1].event, 'feedback'); assert.equal(events[1].sessionId, sessionId); assert.match(events[1].prompt, /boundary test/);
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
