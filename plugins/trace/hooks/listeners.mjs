// One private registration per viewer, scoped to a particular agent session lease.
import {mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync, statSync,
  utimesSync, rmSync, rmdirSync} from 'node:fs';
import {join} from 'node:path';

const directory = lease => lease.path + '.' + encodeURIComponent(lease.token) + '.listeners';
function names(dir) {
  try { return readdirSync(dir); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

export function registerListener(lease, app, reopenedId, close) {
  const root = directory(lease);
  const dir = join(root, app.sessionId);
  const marker = join(dir, 'viewer.json');
  const journal = join(dir, 'reviews');
  mkdirSync(dir, {recursive:true, mode:0o700});
  writeFileSync(journal, reopenedId ? reopenedId + '\n' : '', {mode:0o600});
  const info = {viewer: app.sessionId, pid: process.pid, repo: app.repository.repo, gitDir: app.repository.gitDir};
  writeFileSync(marker, JSON.stringify(info), {mode: 0o600});
  const onReview = review => {
    try { appendFileSync(journal, review.id + '\n'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  };
  app.events.on('review', onReview);
  const heartbeat = setInterval(() => {
    const now = new Date();
    try { utimesSync(marker, now, now); }
    catch { close(); }
  }, 1000);
  app.server.once('close', () => {
    clearInterval(heartbeat);
    app.events.off('review', onReview);
    rmSync(dir, {recursive:true, force:true});
    try { rmdirSync(root); } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
    }
  });
}

export function activeListeners(lease) {
  if (!lease) return [];
  const root = directory(lease);
  const active = [];
  for (const id of names(root)) {
    const dir = join(root, id);
    const marker = join(dir, 'viewer.json');
    try {
      const info = JSON.parse(readFileSync(marker, 'utf8'));
      if (info.viewer === id && Date.now() - statSync(marker).mtimeMs < 15000 && alive(info.pid)) {
        active.push({...info, journal: join(dir, 'reviews')});
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
  }
  return active;
}

export function stopListeners(lease) {
  if (lease) rmSync(directory(lease), {recursive:true, force:true});
}
