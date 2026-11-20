import {posix} from 'node:path';
import {isPythonGraphSource} from '../dist/core.mjs';
import {scanLine} from '../dist/syntax.mjs';

const name = '[_\\p{ID_Start}]\\p{ID_Continue}*';
const dotted = name + '(?:\\.' + name + ')*';
const importItem = new RegExp('^(' + dotted + '|\\*)(?:\\s+as\\s+(' + name + '))?$', 'u');
const calls = new RegExp('(?<![.\\p{ID_Continue}])(' + dotted + ')\\s*\\(', 'gu');

// Reassemble logical statements while keeping strings, examples and comments opaque.
function* statements(text) {
  const state = {};
  let buffer = '', depth = 0;
  for (const line of text.split(/\r?\n/)) {
    let at = 0, code = '';
    for (const token of scanLine(line, 'py', state)) {
      if (token.kind !== 'string' && token.kind !== 'comment') continue;
      code += line.slice(at, token.start) + (token.kind === 'string' ? ' ~ ' : ' ');
      at = token.end;
    }
    code += line.slice(at);
    for (const char of code) {
      if ('([{'.includes(char)) depth++;
      if (')]}'.includes(char)) depth = Math.max(0, depth - 1);
      if (char === ';' && !depth) { yield buffer.trim(); buffer = ''; }
      else buffer += char;
    }
    if (buffer.endsWith('\\')) buffer = buffer.slice(0, -1) + ' ';
    else if (depth) buffer += ' ';
    else { yield buffer.trim(); buffer = ''; }
  }
  if (buffer.trim()) yield buffer.trim();
}

export function addPythonRelations(texts, addEdge) {
  const directories = new Set();
  for (const path of texts.keys()) {
    if (!isPythonGraphSource(path)) continue;
    let directory = posix.dirname(path);
    while (!directories.has(directory)) {
      directories.add(directory);
      directory = posix.dirname(directory);
    }
  }
  // A regular package wins over a same-named module, which in turn wins over
  // a namespace directory. A plain .py file cannot contain submodules.
  function moduleAt(stem) {
    const initializer = posix.join(stem, '__init__.py');
    if (texts.has(initializer)) return {stem, file:initializer, package:true};
    if (texts.has(stem + '.py')) return {stem, file:stem + '.py', package:false};
    if (directories.has(stem)) return {stem, package:true};
  }
  function descend(base, components) {
    let target = {stem:base, package:true};
    for (const part of components) {
      if (!target?.package) return;
      target = moduleAt(posix.join(target.stem, part));
    }
    return target;
  }
  for (const [path, text] of texts) {
    if (!isPythonGraphSource(path)) continue;
    let project = posix.dirname(path);
    while (project !== '.' && !['pyproject.toml','setup.py','setup.cfg'].some(file => texts.has(posix.join(project, file)))) {
      project = posix.dirname(project);
    }
    const src = posix.join(project, 'src');
    const root = path.startsWith(src + '/') ? src : project;
    function resolve(module) {
      const dots = /^\.*/.exec(module)[0].length;
      const tail = module.slice(dots);
      if (!dots) {
        const matches = [project, src].map(base => descend(base, tail.split('.'))).filter(Boolean);
        const concrete = matches.filter(target => target.file);
        if (concrete.length) return concrete.length === 1 ? concrete[0] : undefined;
        return matches.length === 1 ? matches[0] : undefined;
      }
      const parts = posix.relative(root, posix.dirname(path)).split('/').filter(Boolean);
      if (dots > parts.length) return;
      const parent = parts.slice(0, parts.length - dots + 1);
      return descend(root, tail ? [...parent, ...tail.split('.')] : parent);
    }
    const bindings = new Map();
    for (const code of statements(text)) {
      const from = /^from\s+([\p{ID_Continue}.]+)\s+import\s*([\s\S]+)$/u.exec(code);
      const direct = !from && /^import\s+(.+)$/.exec(code);
      if (from || direct) {
        const clause = (from ? from[2] : direct[1]).replace(/^\((.*)\)$/, '$1');
        for (const item of clause.split(',')) {
          const parsed = importItem.exec(item.trim());
          if (!parsed) continue;
          const [, imported, alias] = parsed;
          const parent = from && resolve(from[1]);
          const child = parent?.package && imported !== '*' && moduleAt(posix.join(parent.stem, imported));
          const target = from ? child?.file || parent?.file : resolve(imported)?.file;
          const binding = alias || imported;
          if (target) {
            addEdge(path, target, 'Imports');
            bindings.set(binding, {target, module:!from || !!child});
          } else bindings.delete(binding);
        }
        continue;
      }
      for (const match of code.matchAll(calls)) {
        if (/\b(?:def|class)\s+$/.test(code.slice(0, match.index))) continue;
        const callee = match[1];
        const binding = bindings.get(callee);
        const dot = callee.lastIndexOf('.');
        const owner = dot >= 0 && bindings.get(callee.slice(0, dot));
        if (binding && !binding.module) addEdge(path, binding.target, 'Calls');
        if (owner?.module) addEdge(path, owner.target, 'Calls');
      }
    }
  }
}
