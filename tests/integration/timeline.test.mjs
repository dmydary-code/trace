import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture, session, post} from '../support/harness.mjs';

async function get(app, path) {
  const response = await fetch(app.url + path);
  assert.equal(response.status, 200);
  return response.json();
}

test('unborn timeline, root commit, immutable approval across viewers and amend', async t => {
  const f = await fixture('javascript', {commit:false, changed:false});
  t.after(() => f.dispose());
  const app = await f.server();
  assert.deepEqual((await get(app, '/api/timeline')).commits, []);
  assert((await get(app, '/api/session?scope=overall')).files.length);
  await f.git('add', '.');
  await f.git('commit', '-m', 'Initial implementation');
  const root = await f.git('rev-parse', 'HEAD');
  const s = await get(app, '/api/session?scope=' + root);
  assert(s.files.every(file => file.status === 'A'));
  const endpoint = '/api/commits/' + root + '/approve';
  assert.equal((await post(app, s, endpoint, {}, {Origin:'https://example.invalid'})).status, 403);
  assert.equal((await post(app, s, endpoint)).status, 200);
  assert.equal((await post(app, s, endpoint)).status, 200);
  const reopened = await f.server();
  assert((await get(reopened, '/api/timeline')).commits[0].approved);
  await f.git('commit', '--amend', '-m', 'Rewritten implementation');
  const amended = (await get(reopened, '/api/timeline')).commits[0];
  assert.notEqual(amended.sha, root);
  assert.equal(amended.approved, false);
  assert.equal((await post(reopened, await session(reopened), endpoint)).status, 400);
});

test('historical graph and general messages keep the reviewed tree and exact commit', async t => {
  const f = await fixture('javascript', {changed:false});
  t.after(() => f.dispose());
  const base = await f.git('rev-parse', 'HEAD');
  await f.git('checkout', '-b', 'feature');
  await f.put('src/support.js', 'export const rate = 1;\n');
  await f.put('src/charge.js', "import {rate} from './support.js';\nexport const charge = rate;\n");
  await f.git('add', '.');
  await f.git('commit', '-m', 'Add charge helper');
  const sha = await f.git('rev-parse', 'HEAD');
  await f.git('rm', 'src/charge.js', 'src/support.js');
  await f.git('commit', '-m', 'Retire charge helper');
  const app = await f.server({base:'main', mergeBase:true});
  const s = await get(app, '/api/session?scope=' + sha);
  assert.equal(s.baseRevision, base);
  const {graph} = await get(app, '/api/graph?scope=' + sha + '&revision=' + s.revision);
  assert(graph.edges.some(edge => edge.source === 'src/charge.js' && edge.target === 'src/support.js'));
  const postUrl = '/api/reviews?scope=' + sha;
  const first = await post(app, s, postUrl, {instruction:'Explain this commit.'});
  assert.equal(first.status, 201);
  const {id} = await first.json();
  assert.equal((await post(app, s, postUrl, {instruction:'Duplicate stale submission'})).status, 409);
  const next = await post(app, s, postUrl, {instruction:'What uses it?', previousId:id, replyTo:{reviewId:id,commentId:'review'}});
  assert.equal(next.status, 201);
  const saved = (await next.json()).review;
  assert.equal(saved.commit.sha, sha);
  assert.equal(saved.thread[0].body, 'Explain this commit.');
  const reopened = await f.server({reviewId:saved.id});
  const round = await get(reopened, '/api/session?scope=' + sha);
  assert.deepEqual(round.rounds, [id, saved.id]);
  assert.equal(round.commit.sha, sha);
  assert.equal((await get(reopened, '/api/timeline')).commits.length, 2);
  assert.deepEqual((await get(app, '/api/session?scope=overall')).files, []);
});
