import {isKotlinGraphSource} from '../dist/core.mjs';

const identifier = '(?:\\x60[^\\x60\\r\\n]+\\x60|[\\p{L}_][\\p{L}\\p{Nd}_]*)';
const isIdentifier = new RegExp('^' + identifier + '$', 'u');
const tokens = new RegExp(identifier + '|\\S', 'gu');
const directives = new RegExp(
  '(?:^|(?<=;))[ \\t]*(package|import)[ \\t]+(' + identifier +
  '(?:[ \\t]*\\.[ \\t]*(?:' + identifier + '|\\*))*)(?:[ \\t]+as[ \\t]+(' + identifier +
  '))?[ \\t]*(?=;|$)', 'gmu');
const modifiers = /^(?:private|public|internal|protected|expect|actual|inline|tailrec|suspend|external|operator|infix|data|sealed|open|abstract|final|value|enum|annotation|const|lateinit|override)$/;
const typeDeclarations = new Set(['class', 'interface', 'object', 'typealias']);
const typePrefixes = new Set([':', 'as', 'is', '@']);
const blank = text => text.replace(/[^\r\n]/g, ' ');
const nameOf = token => token?.replace(/^\x60|\x60$/g, '');

function maskLiteralsAndComments(text) {
  const starts = /\/[/*]|"""|["'\x60]/g;
  const blocks = /\/\*|\*\//g;
  const quoted = /"(?:\\[^\r\n]|[^"\\\r\n])*"?|'(?:\\[^\r\n]|[^'\\\r\n])*'?/y;
  const parts = [];
  let cursor = 0;
  for (let match; (match = starts.exec(text));) {
    const {index} = match;
    const start = match[0];
    let end = text.length;
    if (start === '//') {
      const newline = text.indexOf('\n', starts.lastIndex);
      if (newline !== -1) end = newline;
    } else if (start === '/*') {
      blocks.lastIndex = starts.lastIndex;
      let depth = 1;
      for (let block; (block = blocks.exec(text));) {
        depth += block[0] === '/*' ? 1 : -1;
        if (depth === 0) { end = blocks.lastIndex; break; }
      }
    } else if (start === '"""' || start === '\x60') {
      const closing = text.indexOf(start, starts.lastIndex);
      if (closing !== -1) end = closing + start.length;
    } else {
      quoted.lastIndex = index;
      quoted.exec(text);
      end = quoted.lastIndex;
    }
    parts.push(text.slice(cursor, index), start === '\x60' ? text.slice(index, end) : blank(text.slice(index, end)));
    cursor = starts.lastIndex = end;
  }
  return parts.join('') + text.slice(cursor);
}

function functionName(parts, index) {
  if (parts[index] === '<') {
    let depth = 1;
    while (depth && ++index < parts.length) {
      if (parts[index] === '<') depth++;
      if (parts[index] === '>') depth--;
    }
    index++;
  }
  return parts[index + 1] === '(' ? parts[index] : undefined;
}

function analyze(text) {
  let pkg = '';
  const imports = [];
  const code = maskLiteralsAndComments(text).replace(directives, (line, keyword, qualified, alias) => {
    const parts = qualified.split(/[ \t]*\.[ \t]*/).map(nameOf);
    if (keyword === 'package') pkg = parts.join('.');
    else imports.push({pkg: parts.slice(0, -1).join('.'), name: parts.at(-1), alias: nameOf(alias) || parts.at(-1)});
    return blank(line);
  });
  const parts = code.match(tokens) || [];
  const exported = [], ownNames = new Set();
  let braces = 0, parens = 0, brackets = 0;
  for (const [i, token] of parts.entries()) {
    if (token === '{') braces++;
    if (token === '}') braces--;
    if (token === '(') parens++;
    if (token === ')') parens--;
    if (token === '[') brackets++;
    if (token === ']') brackets--;

    const previous = parts[i - 1];
    if (parens && parts[i + 1] === ':' && (previous === '(' || previous === ',') && isIdentifier.test(token)) {
      ownNames.add(nameOf(token));
    }
    const kind = typeDeclarations.has(token) ? 'type' : token === 'fun' ? 'function'
      : token === 'val' || token === 'var' ? 'value' : null;
    if (!kind || previous === ':' || previous === '.') continue;
    const declaration = kind === 'function' ? functionName(parts, i + 1) : parts[i + 1];
    if (!declaration || !isIdentifier.test(declaration)) continue;
    const name = nameOf(declaration);
    ownNames.add(name);
    if (braces || parens || brackets) continue;
    let modifier = i - 1;
    while (modifiers.test(parts[modifier] || '') && parts[modifier] !== 'private') modifier--;
    if (parts[modifier] !== 'private') exported.push({name, kind});
  }
  return {pkg, imports, parts, exported, ownNames};
}

// Duplicate declarations across modules or source sets are ambiguous without
// Gradle's compilation model. Preserve only unambiguous declaring files.
const keyFor = (pkg, name) => pkg ? pkg + '.' + name : name;
export function addKotlinRelations(texts, addEdge) {
  const files = new Map(), symbols = new Map();
  for (const [path, text] of texts) {
    if (!isKotlinGraphSource(path)) continue;
    const file = analyze(text);
    files.set(path, file);
    for (const {name, kind} of file.exported) {
      const key = keyFor(file.pkg, name);
      const first = symbols.get(key);
      if (!symbols.has(key)) symbols.set(key, {path, kind});
      else if (first?.path !== path || first.kind !== kind) symbols.set(key, null);
    }
  }

  for (const [path, {pkg, imports, parts, ownNames}] of files) {
    const explicit = new Map(), wildcards = new Set();
    for (const entry of imports) {
      if (entry.name === '*') { wildcards.add(entry.pkg); continue; }
      const target = symbols.get(keyFor(entry.pkg, entry.name));
      explicit.set(entry.alias, explicit.has(entry.alias) ? null : target);
      if (target) addEdge(path, target.path, 'Imports');
    }
    for (const [i, token] of parts.entries()) {
      const previous = parts[i - 1], next = parts[i + 1];
      const call = next === '(';
      const typePosition = typePrefixes.has(previous) || next === '.';
      if (!(call || typePosition) || previous === '.' || !isIdentifier.test(token)) continue;
      const name = nameOf(token);
      if (ownNames.has(name)) continue;
      const key = keyFor(pkg, name);
      let target = explicit.has(name) ? explicit.get(name) : symbols.get(key);
      let fromWildcard = false;
      if (!explicit.has(name) && !symbols.has(key) && wildcards.size) {
        const matches = [...wildcards].map(p => keyFor(p, name)).filter(k => symbols.has(k));
        if (matches.length === 1) {
          target = symbols.get(matches[0]);
          fromWildcard = true;
        }
      }
      if (!target) continue;
      if (call && target.kind === 'function') addEdge(path, target.path, 'Calls');
      else if ((typePosition || call) && target.kind === 'type') addEdge(path, target.path, 'Uses type');
      else continue;
      if (fromWildcard) addEdge(path, target.path, 'Imports');
    }
  }
}
