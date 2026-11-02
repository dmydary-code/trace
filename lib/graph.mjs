import {gitOutput} from './git-command.mjs';
import {readFile, realpath} from 'node:fs/promises';
import {resolve, posix, sep} from 'node:path';
const git = (repo, ...args) => gitOutput(['--literal-pathspecs', '-C', repo, ...args]);
export async function buildGraph(repo, snapshot) {
  repo = await realpath(repo);
  const base = snapshot.baseRevision;
  const paths = [...new Set([...(await git(repo, 'ls-files', '-z')).split('\0'), ...snapshot.files.map(f => f.path)])].filter(Boolean);
  const beforePaths = (await git(repo, 'ls-tree', '-r', '--name-only', '-z', base).catch(() => '')).split('\0').filter(Boolean);
  let config = {};
  try { config = JSON.parse(await readFile(resolve(repo, '.trace-graph.json'), 'utf8')); } catch {}
  const changed = new Map(snapshot.files.map(f => [f.path, f]));
  const aliases = new Map(snapshot.files.filter(f => f.oldPath).map(f => [f.oldPath, f.path]));
  const canonical = p => aliases.get(p) || p;
  const texts = {before: new Map(), after: new Map()};
  async function read(path, version) {
    try {
      let text;
      if (version === 'before') text = await git(repo, 'show', `${base}:${path}`);
      else if (snapshot.comparison === 'staged') text = await git(repo, 'show', `:${path}`);
      else {
        const absolute = await realpath(resolve(repo, path));
        if (!absolute.startsWith(repo + sep)) return null;
        text = await readFile(absolute, 'utf8');
      }
      return text.length <= 1024 * 1024 && !text.includes('\0') ? text : null;
    } catch { return null; }
  }
  for (const [version, names] of [['before', beforePaths], ['after', paths]]) {
    for (const path of names) {
      const text = await read(path, version);
      if (text !== null) texts[version].set(path, text);
    }
  }
  function edges(texts) {
    const result = new Map();
    for (const [path, text] of texts) {
      if (!/\.[cm]?[jt]sx?$/.test(path)) continue;
      const imports = /\b(import|export)\s+(type\s+)?([^;\n]*?)\s+from\s*['"]([^'"]+)['"]|\b(?:import\s*|require\s*\()(['"])([^'"]+)\5/g;
      for (const match of text.matchAll(imports)) {
        const spec = match[4] || match[6];
        if (!spec.startsWith('.')) continue;
        const stem = posix.normalize(posix.join(posix.dirname(path), spec));
        const candidates = [stem, ...['.ts','.tsx','.js','.jsx','.mjs','.cjs','/index.ts','/index.tsx','/index.js'].map(ext => stem + ext), stem.replace(/\.js$/, '.ts'), stem.replace(/\.js$/, '.tsx')];
        const target = candidates.find(p => texts.has(p));
        if (!target || canonical(target) === canonical(path)) continue;
        const add = kind => {const e = {source:canonical(path), target:canonical(target), kind}; result.set(JSON.stringify(e), e);};
        add(match[2] ? 'Uses type' : 'Imports');
        const bindings = (match[3] || '').match(/[A-Za-z_$][\w$]*/g) || [];
        const body = text.slice(0, match.index) + text.slice(match.index + match[0].length);
        if (!match[2] && bindings.some(name => !['as','type'].includes(name) && new RegExp('\\b' + name.replace(/\$/g,'\\$') + '\\s*\\(').test(body))) add('Calls');
      }
    }
    return result;
  }
  const before = edges(texts.before), after = edges(texts.after);
  const all = new Map([...before, ...after]);
  const edgesList = [...all].map(([key,e]) => ({...e, change:!before.has(key) ? '+' : !after.has(key) ? '−' : null}));
  const allPaths = [...new Set([...paths, ...snapshot.files.map(f=>f.path)])];
  const nodes = allPaths.map(path => {
    const f = changed.get(path);
    // Explicit directory conventions only; generic .test files stay unclassified.
    const configured = Object.entries(config.testDirectories || {}).find(([kind, dirs]) => ['unit','integration','e2e'].includes(kind) && Array.isArray(dirs) && dirs.some(dir => typeof dir === 'string' && path.startsWith(dir.replace(/\/$/, '') + '/')))?.[0];
    const test = configured || /(?:^|\/)(?:e2e|__e2e__)\//.test(path) ? 'e2e' : /(?:^|\/)(?:integration|__integration__)\//.test(path) ? 'integration' : /(?:^|\/)(?:unit|__unit__)\//.test(path) ? 'unit' : /(?:test|spec)[./]|__tests__/.test(path) ? 'test' : 'code';
    const icon = test !== 'code' ? '⚗' : /(?:types?|contracts?)[/.]/i.test(path) ? '{}' : /migration|\.sql$/i.test(path) ? '▤' : /config|package\.json|lock$/i.test(path) ? '⚙' : /\.(md|png|svg|jpg)$/i.test(path) ? '▧' : '‹›';
    return {path, changed:!!f, status:f?.status, oldPath:f?.oldPath, test, icon};
  });
  return {nodes, edges:edgesList, sources:Object.fromEntries(nodes.map(n => [n.path, texts.after.get(n.path) ?? texts.before.get(n.oldPath || n.path) ?? null]))};
}
