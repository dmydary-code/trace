import {posix} from 'node:path';

const extension = /\.[cm]?[jt]sx?$/;
const suffixes = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];

function relativeTarget(files, path, specifier) {
  if (!specifier.startsWith('.')) return;
  const stem = posix.join(posix.dirname(path), specifier);
  return [stem, ...suffixes.map(ext => stem + ext),
    ...suffixes.map(ext => posix.join(stem, 'index' + ext)),
    stem.replace(/\.([cm]?)js$/, '.$1ts'), stem.replace(/\.jsx?$/, '.tsx')]
    .find(candidate => files.has(candidate));
}

// Keep quoted examples opaque while recognizing comments between declaration tokens.
const literals = /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/g;
const ident = '[$A-Z_a-z][$\\w]*';
const list = new RegExp('^(?:type\\s+)?(' + ident + ')(?:\\s+as\\s+(' + ident + '))?$');
const nameOrGroup = '(?:\\{[^{};"\'\x60]*\\}|\\*(?:\\s+as\\s+' + ident + ')?|' + ident + ')';
const from = new RegExp('^(import|export)\\s*(?:(type)\\s+)?(' + nameOrGroup +
  '(?:\\s*,\\s*' + nameOrGroup + ')?)\\s*from\\s*(["\'])([^"\'\\n]+)\\4');
const localExport = /^export\s*(?:(type)\s+)?\{([^{};]*)\}/;
const requireCall = /^require\s*\(\s*(["'])([^"'\n]+)\1\s*\)/;
const sideEffect = /^import\s*(["'])([^"'\n]+)\1/;

function bindings(clause, isImport) {
  if (clause.startsWith('{')) {
    return clause.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean).map(item => {
      const match = list.exec(item);
      return match && {name: match[1], alias: match[2] || match[1], type: /^type\s+\S/.test(item) && match[1] !== 'type'};
    });
  }
  if (clause.startsWith('*')) return [{name: '*', alias: clause.split(/\s+/).at(-1)}];
  const [first, rest] = clause.split(/,([\s\S]+)/);
  return [{name: isImport ? 'default' : first, alias: first.trim()}, ...(rest ? bindings(rest.trim(), isImport) : [])];
}

function analyze(files, path, text) {
  const code = text.replace(literals, token => token.startsWith('/') ? ' ' : token)
    .replace(/^\s*(['"])use strict\1(?:\s*;|[ \t]*\n)/, '');
  const imports = [], rules = [], locals = new Map(), exposed = new Set();
  const cjs = /^\s*module\s*\.\s*exports\s*=\s*require\s*\(\s*(["'])([^"'\n]+)\1\s*\)\s*;?\s*$/.exec(code);
  if (cjs) return {imports, exposed, rules: [{name: '*', alias: '*', target: relativeTarget(files, path, cjs[2]), commonJS: true}]};

  // Anything outside the forwarding declarations keeps the module in the graph.
  let cursor = 0, pure = true;
  const keywords = new RegExp(literals.source + '|\\b(?:export|import|require)\\b', 'g');
  for (let token; (token = keywords.exec(code));) {
    if (!['export', 'import', 'require'].includes(token[0])) continue;
    if (pure && /[^;\s]/.test(code.slice(cursor, token.index))) pure = false;
    const statement = code.slice(token.index);
    const declaration = from.exec(statement);
    const own = !declaration && localExport.exec(statement);
    const defaultAlias = !declaration && /^export\s+default\s+([$\w]+)\b/.exec(statement);
    if (defaultAlias && locals.has(defaultAlias[1])) {
      exposed.add('default');
      rules.push({local: true, name: defaultAlias[1], alias: 'default'});
      cursor = keywords.lastIndex = token.index + defaultAlias[0].length;
      continue;
    }
    const simple = !declaration && !own && (requireCall.exec(statement) || sideEffect.exec(statement));
    if (!declaration && !own && !simple) {
      pure = false;
      const declared = /^export\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:const|let|var|function\s*\*?|class|type|interface|enum|namespace)\s+([$\w]+)/.exec(statement);
      if (declared) exposed.add(declared[1]);
      continue;
    }
    const match = declaration || own || simple;
    cursor = keywords.lastIndex = token.index + match[0].length;
    if (simple) {
      pure = false;
      imports.push({target: relativeTarget(files, path, simple[2]), name: '*'});
      continue;
    }
    const isImport = declaration?.[1] === 'import';
    const target = declaration && relativeTarget(files, path, declaration[5]);
    const clause = own ? '{' + own[2] + '}' : declaration[3];
    for (const binding of bindings(clause, isImport)) {
      if (!binding) { pure = false; continue; }
      const entry = {...binding, target, type: !!(binding.type || (own ? own[1] : declaration[2]))};
      if (isImport) {
        locals.set(entry.alias, entry);
        imports.push(entry);
      } else {
        exposed.add(entry.alias);
        if (own) rules.push({...entry, local: true});
        else { rules.push(entry); imports.push(entry); }
      }
    }
  }
  const forwardedLocals = new Set();
  for (const rule of rules.filter(rule => rule.local)) {
    const imported = locals.get(rule.name);
    if (!imported) { pure = false; continue; }
    forwardedLocals.add(rule.name);
    Object.assign(rule, {target: imported.target, name: imported.name, type: rule.type || imported.type});
  }
  pure &&= !/[^;\s]/.test(code.slice(cursor)) && forwardedLocals.size === locals.size;
  const body = code.replace(literals, ' ');
  for (const ref of imports) {
    if (ref.alias && ref.name !== '*' && !ref.type) {
      ref.called = new RegExp('(?<![.\\w$])' + ref.alias.replace(/\$/g, '\\$') + '\\s*\\(').test(body);
    }
  }
  return {imports, exposed, rules: pure && rules.length ? rules : null};
}

export function graphRelations(texts, canonical) {
  const modules = new Map();
  for (const [path, text] of texts) if (extension.test(path)) modules.set(path, analyze(texts, path, text));
  const edges = new Map(), barrels = new Set();
  for (const [path, module] of modules) {
    if (module.rules) { barrels.add(canonical(path)); continue; }
    const source = canonical(path);
    for (const ref of module.imports) {
      const pending = [ref], visited = new Set();
      while (pending.length) {
        const {target, name, type, viaStar} = pending.pop();
        if (!target) continue;
        const key = JSON.stringify([target, name, !!type, !!viaStar]);
        if (visited.has(key)) continue;
        visited.add(key);
        const next = modules.get(target);
        if (next?.rules) {
          const explicit = next.rules.some(rule => rule.alias === name && name !== '*');
          for (const rule of next.rules) {
            const star = rule.alias === '*';
            if (star && (explicit || name === 'default' && !rule.commonJS)) continue;
            if (!star && name !== '*' && rule.alias !== name) continue;
            pending.push({target: rule.target, name: star ? name : rule.name, type: type || rule.type,
              viaStar: star && !rule.commonJS});
          }
          continue;
        }
        if (viaStar && name !== '*' && next && !next.exposed.has(name)) continue;
        if (canonical(target) === source) continue;
        const kinds = type ? ['Uses type'] : ref.called ? ['Imports', 'Calls'] : ['Imports'];
        for (const kind of kinds) {
          const edge = {source, target: canonical(target), kind};
          edges.set(JSON.stringify(edge), edge);
        }
      }
    }
  }
  return {edges, barrels};
}
