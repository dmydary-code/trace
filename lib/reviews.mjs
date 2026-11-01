import {mkdir, readFile, writeFile, readdir, rename, link, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function reviewDirectory(gitDir, id) {
  if (!uuid.test(id || '')) throw new Error('Invalid review ID');
  return join(gitDir, 'trace', 'reviews', id);
}
export function commentId(value) { return uuid.test(value || '') ? value : randomUUID(); }
export async function saveReview(gitDir, review, snapshot) {
  const dir = reviewDirectory(gitDir, review.id);
  await mkdir(dir, {recursive: true, mode: 0o700});
  await writeFile(join(dir, 'snapshot.json'), JSON.stringify(snapshot), {mode: 0o600, flag: 'wx'});
  await writeFile(join(dir, 'review.json'), JSON.stringify(review, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
  await writeFile(join(dir, 'prompt.md'), review.prompt + '\n', {mode: 0o600});
  const latest = join(gitDir, 'trace', 'latest.json');
  await writeFile(latest + '.' + review.id, JSON.stringify(review, null, 2) + '\n', {mode: 0o600});
  await rename(latest + '.' + review.id, latest);
}
export async function readReview(gitDir, id) {
  const file = id ? join(reviewDirectory(gitDir, id), 'review.json') : join(gitDir, 'trace', 'latest.json');
  const review = JSON.parse(await readFile(file, 'utf8').catch(() => { throw new Error('Submitted review not found'); }));
  const dir = join(reviewDirectory(gitDir, review.id), 'replies');
  const names = await readdir(dir).catch(err => { if (err.code === 'ENOENT') return []; throw err; });
  // Each reply is immutable and atomically published, so parallel agents cannot overwrite one another.
  const replies = await Promise.all(names.filter(name => uuid.test(name.replace(/\.json$/, '')) && name.endsWith('.json')).map(async name => JSON.parse(await readFile(join(dir, name), 'utf8'))));
  replies.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const completion = await readFile(join(reviewDirectory(gitDir, review.id), 'completion.json'), 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  return {...review, replies, completion};
}
export async function readSnapshot(gitDir, id) {
  return JSON.parse(await readFile(join(reviewDirectory(gitDir, id), 'snapshot.json'), 'utf8').catch(() => { throw new Error('This review has no saved diff. Open a new review.'); }));
}
export async function addReply(gitDir, {reviewId, commentId: target, agent, body, status = 'addressed'}) {
  if (!['codex', 'claude'].includes(agent)) throw new Error('Reply agent must be codex or claude');
  if (!['addressed', 'needs_input', 'not_changed', 'note'].includes(status)) throw new Error('Invalid reply status');
  if (typeof body !== 'string' || !body.trim() || body.length > 10000) throw new Error('Reply must contain 1–10000 characters');
  const review = await readReview(gitDir, reviewId);
  if (!(review.comments.some(c => c.id === target) || target === 'review' && review.instruction)) throw new Error('Comment does not belong to this review');
  const reply = {id: randomUUID(), reviewId, commentId: target, author: {name: agent === 'codex' ? 'Codex' : 'Claude', kind: 'agent'}, body: body.trim(), status, createdAt: new Date().toISOString()};
  const dir = join(reviewDirectory(gitDir, reviewId), 'replies');
  await mkdir(dir, {recursive: true, mode: 0o700});
  const temporary = join(dir, reply.id + '.tmp');
  await writeFile(temporary, JSON.stringify(reply, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
  await rename(temporary, join(dir, reply.id + '.json'));
  return reply;
}

export async function approveSavedReview(gitDir, id, snapshot) {
  const review = await readReview(gitDir, id);
  if (review.outcome !== 'changes_requested' || review.completion) throw new Error('This review is already complete');
  const completion = {outcome: 'approved', revision: snapshot.revision, author: snapshot.author, createdAt: new Date().toISOString(), snapshotFile: `approved-${randomUUID()}.json`};
  const dir = reviewDirectory(gitDir, id);
  // Publish one complete record exclusively; preserve the original request and thread anchors.
  await writeFile(join(dir, completion.snapshotFile), JSON.stringify(snapshot), {mode: 0o600, flag: 'wx'});
  const temporary = join(dir, randomUUID() + '.tmp');
  await writeFile(temporary, JSON.stringify(completion), {mode: 0o600, flag: 'wx'});
  try { await link(temporary, join(dir, 'completion.json')); } finally { await unlink(temporary); }
  return readReview(gitDir, id);
}
