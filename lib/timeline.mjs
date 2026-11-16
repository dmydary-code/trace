import {access, mkdir, readdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {gitOutput} from './git-command.mjs';

export const isCommitId = id => typeof id === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(id);

export function commitTimeline(repository, options) {
  const git = (...args) => gitOutput(['-C', repository.repo, ...args]);
  const marks = join(repository.gitDir, 'trace', 'approved-commits');
  let boundary;
  async function range(head) {
    if (options.base && options.base !== 'HEAD') {
      return {ref: repository.baseRevision, label: options.base};
    }
    const branch = (await git('symbolic-ref', '--short', '-q', 'HEAD').catch(() => '')).trim();
    const remote = (await git('symbolic-ref', '--short', '-q', 'refs/remotes/origin/HEAD').catch(() => '')).trim();
    const main = remote || (await git('rev-parse', '--verify', 'refs/heads/main').then(() => 'main', () => 'master'));
    if (branch && branch !== main.replace(/^origin\//, '')) {
      const ref = (await git('merge-base', head, main).catch(() => '')).trim();
      if (ref) return {ref, label: main};
    }
    const ref = (await git('rev-parse', '--verify', head + '~20').catch(() => '')).trim();
    return {ref, label: ref ? ref.slice(0, 8) : 'start of history'};
  }
  async function list() {
    const head = (await git('rev-parse', '--verify', 'HEAD').catch(() => '')).trim();
    const empty = (await git('hash-object', '-t', 'tree', '--stdin')).trim();
    if (!head) return {commits: [], ref: empty, label: 'start of history'};
    boundary ??= await range(head);
    const raw = await git('log', '--first-parent', '--reverse', '-z', '--format=%H%x00%P%x00%s%x00%b%x00%an%x00%aI',
      boundary.ref ? boundary.ref + '..' + head : head, '--');
    const fields = raw.split('\0');
    const approved = new Set(await readdir(marks).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    }));
    const commits = [];
    for (let i = 0; i + 5 < fields.length; i += 6) {
      const [sha, parents, subject, body, author, date] = fields.slice(i, i + 6);
      commits.push({sha, parent: parents.split(' ')[0] || empty, subject, body: body.trimEnd(), author, date, approved: approved.has(sha)});
    }
    return {commits, ref: boundary.ref || empty, label: boundary.label};
  }
  async function approve(sha) {
    if (!isCommitId(sha) || !(await list()).commits.some(commit => commit.sha === sha)) throw Error('Commit is outside this timeline');
    await mkdir(marks, {recursive: true, mode: 0o700});
    await writeFile(join(marks, sha), '', {mode: 0o600});
  }
  async function isApproved(sha) {
    if (!isCommitId(sha)) return false;
    return access(join(marks, sha)).then(() => true, error => {
      if (error.code === 'ENOENT') return false;
      throw error;
    });
  }
  return {list, approve, isApproved};
}
