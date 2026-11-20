// Local lexical highlighting. Offsets are UTF-16 columns, shared with Find Usages.
const extensions = {
  js: 'js jsx ts tsx mjs cjs mts cts', py: 'py pyi', kotlin: 'kt kts',
  java: 'java', cs: 'cs', swift: 'swift', rust: 'rs', go: 'go',
  cpp: 'c h cc cpp cxx hpp', json: 'json jsonc', shell: 'sh bash zsh',
  ruby: 'rb', yaml: 'yaml yml', toml: 'toml', css: 'css scss',
  sql: 'sql', markup: 'html htm xml svg vue svelte',
};
const languages = new Map(Object.entries(extensions).flatMap(([lang, exts]) =>
  exts.split(' ').map(ext => [ext, lang])));
export const sourceLanguage = path => languages.get(path?.split('.').pop()?.toLowerCase());

const words = {
  js: 'import from export as return const let var function class interface type if else new await async throw try catch for while extends implements public private protected static readonly default typeof void this super switch case break continue do finally delete in instanceof of yield enum namespace declare abstract override constructor satisfies keyof',
  py: 'import from as return def class if else elif for while async await raise try except finally with lambda pass and or not is in yield global nonlocal assert del break continue match case',
  kotlin: 'package import as fun val var class interface return if else for while is in when object companion internal sealed data suspend where get set by init override open abstract private public protected constructor',
  java: 'package import class interface extends implements public private protected static final void return if else new throw throws try catch for while switch case break continue abstract enum this super',
  cs: 'using namespace class struct interface public private protected static readonly return if else new async await throw try catch for foreach while in var void this',
  swift: 'import func var let class struct enum protocol extension associatedtype return if else guard defer for while in case switch public private final some any throws rethrows operator inout',
  rust: 'mod use pub fn impl trait struct enum let mut match if else for while loop in return self as where async await move const',
  go: 'package import func var const type struct interface return if else for range go defer chan select case switch break continue map',
  cpp: 'include define class struct template typename namespace using const auto static int void char bool double float long short return if else for while new public private protected virtual override',
  shell: 'if then else elif fi for while do done case esac in function local export',
  ruby: 'def class module end return if else elsif do unless begin rescue ensure require',
  sql: 'select from where join inner outer left right on group by order insert into values update set delete create table as and or not null limit',
};
const keywords = Object.fromEntries(Object.entries(words).map(([k,v]) => [k,new Set(v.split(' '))]));
const literalWords = {
  js:'true false null undefined', py:'True False None', ruby:'true false nil',
  swift:'true false nil', go:'true false nil', rust:'true false', cpp:'true false nullptr NULL',
  sql:'true false null', kotlin:'true false null', cs:'true false null', java:'true false null',
  json:'true false null', yaml:'true false null', toml:'true false',
};
const constants = Object.fromEntries(Object.entries(literalWords).map(([k,v]) => [k,new Set(v.split(' '))]));
const hashComment = new Set(['py','ruby','shell','yaml','toml']);
const tripleQuote = new Set(['py','kotlin','swift','java','toml']);
const lexeme = /[$_\p{ID_Start}][$\p{ID_Continue}\u200c\u200d]*|\b(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)[nN]?/uy;

export function scanLine(text, lang, state) {
  const tokens = [];
  for (let i = 0; i < text.length;) {
    const start = i;
    let kind;
    const c = text[i];
    if (!state.end) {
      if ((hashComment.has(lang) && c === '#') || (lang === 'sql' && text.startsWith('--', i)) ||
          (!hashComment.has(lang) && lang !== 'sql' && lang !== 'markup' && text.startsWith('//', i))) {
        tokens.push({kind:'comment', start, end:text.length});
        break;
      }
      if (!hashComment.has(lang) && text.startsWith('/*', i)) {
        Object.assign(state, {end:'*/', kind:'comment', multi:true});
        i += 2;
      } else if (lang === 'markup' && text.startsWith('<!--', i)) {
        Object.assign(state, {end:'-->', kind:'comment', multi:true});
        i += 4;
      } else if (c === '"' || c === "'" || c === '`') {
        const end = tripleQuote.has(lang) && text.startsWith(c.repeat(3), i) ? c.repeat(3) : c;
        Object.assign(state, {end, kind:'string', multi:end.length === 3 || c === '`'});
        i += end.length;
      }
    }
    if (state.end) {
      kind = state.kind;
      while (i < text.length) {
        if (text.startsWith(state.end, i)) { i += state.end.length; state.end = null; break; }
        if (kind === 'string' && text[i] === '\\') i++;
        i++;
      }
      i = Math.min(i, text.length);
      if (!state.multi && !text.endsWith('\\')) state.end = null;
    } else {
      lexeme.lastIndex = i;
      const match = lexeme.exec(text);
      if (!match) { i++; continue; }
      const value = match[0];
      i = lexeme.lastIndex;
      if (/^\d/.test(value)) kind = 'number';
      else if (constants[lang]?.has(lang === 'sql' ? value.toLowerCase() : value)) kind = 'literal';
      else if (keywords[lang]?.has(lang === 'sql' ? value.toLowerCase() : value)) kind = 'keyword';
      else if (lang === 'markup' && /<\/?$/.test(text.slice(Math.max(0, start - 2), start))) kind = 'keyword';
      else if (lang === 'py' && /^(?:[brfu]|br|rb|fr|rf)$/i.test(value) && /['"]/.test(text.charAt(i))) kind = 'string';
      else if (/^\s*\(/.test(text.slice(i))) kind = 'function';
      else if (/^\p{Lu}/u.test(value)) kind = 'type';
      else kind = 'identifier';
    }
    tokens.push({start, end:i, kind});
  }
  return tokens;
}

export function tokenHtml(text, tokens, escape, colored = true) {
  let at = 0, html = '';
  for (const token of tokens) {
    const color = colored && token.kind !== 'identifier' ? 'syn-' + token.kind : '';
    if (!color && !token.name) continue;
    html += escape(text.slice(at, token.start));
    const attrs = token.name ? ` tabindex="0" data-symbol="${escape(token.name)}" data-offset="${token.start}"` : '';
    html += `<span class="${[color, token.name && 'diff-symbol'].filter(Boolean).join(' ')}"${attrs}>${escape(text.slice(token.start, token.end))}</span>`;
    at = token.end;
  }
  return html + escape(text.slice(at));
}

export function sourceHtml(text, path, escape) {
  const lang = sourceLanguage(path);
  if (!lang) return escape(text);
  const state = {};
  return text.split('\n').map(line => tokenHtml(line, scanLine(line, lang, state), escape)).join('\n');
}
