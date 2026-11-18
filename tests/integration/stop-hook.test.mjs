import test from '../support/test.mjs';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fixture, session, post, comment, eventually} from '../support/harness.mjs';

const stop = async (f, sessionId = 'fixture-session') => JSON.parse(await f.hook('Stop', sessionId));
const pending = async (f, sessionId = 'fixture-session') => {
  const {stdout} = await f.cli('pending', '--session-id', sessionId, '--timeout', '0', '--json');
  return JSON.parse(stdout);
};

for (const variant of ['default', 'legacy Codex', 'legacy Claude', 'legacy Claude without hooks']) {
  test(`${variant} launches keep listening across two messages and release on approval`, async t => {
    const f = await fixture();
    t.after(() => f.dispose());
    const bound = variant !== 'legacy Claude without hooks';
    if (variant === 'legacy Codex') {
      await f.hook('SessionStart');
      f.env.CODEX_THREAD_ID = 'fixture-session';
    }
    if (variant.startsWith('legacy Claude')) f.env.CLAUDECODE = '1';
    const run = await f.start({lease: bound && variant !== 'legacy Codex', args: variant === 'default' ? [] : ['--wait']});
    assert.equal((await stop(f)).decision, bound ? 'block' : undefined);
    assert.deepEqual(await stop(f, 'another-terminal'), {});

    const app = {url: run.ready.url};
    const snapshot = await session(app);
    const question = comment(snapshot);
    const first = await post(app, snapshot, '/api/reviews?scope=changes', {comments: [question]});
    assert.equal(first.status, 201);
    const {id} = await first.json();
    await eventually(() => run.events.some(event => event.event === 'feedback' && event.id === id), 'First message was not delivered');
    if (bound) assert.equal((await pending(f)).feedback[0].comments[0].id, question.id);
    const file = join(f.dir, 'answer.txt');
    await writeFile(file, 'The fixture adds one to the subtotal.');
    await f.cli('reply', '--review', id, '--comment', question.id, '--agent', 'codex', '--body-file', file);
    if (bound) {
      assert.equal((await pending(f)).status, 'waiting');
      assert.equal((await stop(f)).decision, 'block');
    }

    const followUp = {previousId: id, instruction: 'What about taxes?'};
    const second = await post(app, snapshot, '/api/reviews?scope=changes', followUp);
    assert.equal(second.status, 201);
    const next = await second.json();
    await eventually(() => run.events.some(event => event.event === 'feedback' && event.id === next.id), 'Follow-up was not delivered');
    if (bound) assert.equal((await pending(f)).feedback[0].instruction, followUp.instruction);
    const approval = {previousId: next.id, outcome: 'approved', closeViewer: true};
    assert.equal((await post(app, snapshot, '/api/reviews?scope=changes', approval)).status, 201);
    assert.equal(await run.exited, 0);
    assert.deepEqual(await stop(f), {});
    assert.equal((await pending(f)).status, 'closed');
  });
}

test('open listens by default, recovers a saved question and stops independently', async t => {
  const f = await fixture();
  t.after(() => f.dispose());
  const app = await f.server();
  const snapshot = await session(app);
  const submission = await post(app, snapshot, undefined, {comments: [comment(snapshot)]});
  const {id} = await submission.json();
  const run = await f.start({command: 'open', sessionId: 'first', args: ['--review', id]});
  const other = await f.start({sessionId: 'other', args: ['--listen']});
  assert.equal((await pending(f, 'first')).feedback[0].id, id);

  await f.cli('stop-waiting', '--session-id', 'first');
  assert.equal(await run.exited, 0);
  assert.equal((await stop(f, 'other')).decision, 'block');
  await f.hook('Interrupt', 'other');
  assert.equal(await other.exited, 0);
  assert.deepEqual(await stop(f, 'other'), {});
});

test('a timed-out, cancelled or crashed listener cannot block the next turn', async t => {
  const f = await fixture();
  t.after(() => f.dispose());
  const timed = await f.start({args: ['--listen', '--timeout', '0.5']});
  assert.equal(await timed.exited, 2);
  assert.deepEqual(await stop(f), {});

  const cancelled = await f.start({args: ['--listen']});
  const app = {url: cancelled.ready.url};
  await post(app, await session(app), undefined, {outcome: 'cancelled'});
  assert.equal(await cancelled.exited, 3);
  assert.deepEqual(await stop(f), {});

  const crash = await f.start({args: ['--listen']});
  process.kill(crash.ready.viewerPid, 'SIGKILL');
  assert.equal(await crash.exited, 1);
  assert.deepEqual(await stop(f), {});
});
