import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile, lstat, readlink} from 'node:fs/promises';
import {resolve, join, basename} from 'node:path';
import {createHash} from 'node:crypto';
import {parseDiff} from '../dist/core.mjs';

const exec = promisify(execFile);
const maxBuffer = 32 * 1024 * 1024;
const git = (repo, ...args) => exec('git', ['--literal-pathspecs', '-C', repo, ...args], {maxBuffer}).then(r => r.stdout);

export async function openRepository(directory, {base = 'HEAD', staged = false, mergeBase = false} = {}) {
  const repo = (await git(resolve(directory), 'rev-parse', '--show-toplevel')).trimEnd();
  const gitDir = (await git(repo, 'rev-parse', '--absolute-git-dir')).trimEnd();
  let ref;
  try { ref = (await git(repo, 'rev-parse', '--verify', '--end-of-options', `${base}^{commit}`)).trim(); }
  catch {
    // A newly initialized repository has no HEAD yet.
    const headExists = await git(repo, 'rev-parse', '--verify', 'HEAD').then(() => true, () => false);
    if (base !== 'HEAD' || headExists) throw new Error(`Cannot resolve base revision: ${base}`);
    ref = await new Promise((ok, fail) => { const child = spawn('git', ['-C', repo, 'hash-object', '-t', 'tree', '--stdin']); let value = ''; child.stdout.on('data', d => value += d); child.on('error', fail); child.on('close', code => code === 0 ? ok(value.trim()) : fail(new Error('Cannot create empty-tree reference'))); child.stdin.end(); });
  }
  if (mergeBase) ref = (await git(repo, 'merge-base', ref, 'HEAD')).trim();
  const diffArgs = ['-c', 'core.quotePath=false', 'diff', '--no-ext-diff', '--no-textconv', '--no-color', '--find-renames', ...(staged ? ['--cached'] : []), ref];

  async function snapshot() {
    const entries = (await git(repo, ...diffArgs, '--name-status', '-z', '--')).split('\0');
    const changes = [];
    for (let i = 0; i < entries.length && entries[i];) {
      const status = entries[i++], first = entries[i++];
      const renamed = /^[RC]/.test(status), path = renamed ? entries[i++] : first;
      changes.push({path, status: status[0], ...(renamed ? {oldPath: first} : {})});
    }
    if (!staged) {
      const untracked = (await git(repo, 'ls-files', '--others', '--exclude-standard', '-z')).split('\0').filter(Boolean);
      changes.push(...untracked.map(path => ({path, status: '?'})));
    }
    const head = await git(repo, 'rev-parse', 'HEAD').then(s => s.trim(), () => 'unborn');
    const hash = createHash('sha256').update(JSON.stringify({repo, head, ref, staged}));
    const files = [];
    for (const change of changes) {
      hash.update(JSON.stringify(change));
      let lines = [], note = '', patch = '';
      if (change.status === '?') {
        const path = join(repo, change.path), stat = await lstat(path);
        if (stat.isDirectory()) { note = 'Untracked directory or nested repository'; hash.update(String(stat.mtimeMs)); }
        else {
          const bytes = stat.isSymbolicLink() ? Buffer.from(await readlink(path)) : await readFile(path);
          hash.update(bytes).update(String(stat.mode));
          if (bytes.includes(0)) note = 'Binary file — line comments are unavailable';
          else if (bytes.length > 1024 * 1024) note = 'File exceeds 1 MiB — line preview omitted';
          else {
            const text = bytes.toString('utf8'), content = text.split('\n');
            if (content.at(-1) === '') content.pop();
            lines = content.map((text, i) => ({kind: 'add', text, old: null, new: i + 1}));
            if (!lines.length) note = 'Empty untracked file';
          }
        }
      } else {
        patch = await git(repo, ...diffArgs, '--unified=4', '--', ...(change.oldPath ? [change.oldPath] : []), change.path);
        hash.update(patch);
        lines = parseDiff(patch)[0]?.lines || [];
        if (!lines.length) note = /Binary files|GIT binary patch/.test(patch) ? 'Binary change — line comments are unavailable' : change.oldPath ? `Renamed from ${change.oldPath}` : 'Metadata change — no text lines changed';
      }
      files.push({...change, id: `file-${files.length}`, lines, note});
    }
    return {repo: basename(repo), repositoryId: createHash('sha256').update(repo).digest('hex').slice(0, 16), branch: (await git(repo, 'branch', '--show-current')).trim() || head.slice(0, 7), base, comparison: mergeBase ? 'merge-base' : staged ? 'staged' : 'working-tree', revision: hash.digest('hex'), files};
  }
  return {repo, gitDir, snapshot};
}
