import {sourceLanguage, scanLine} from './syntax.mjs';
const globalsByLanguage={
 js:'Math JSON Object Array String Number Boolean BigInt Symbol Date RegExp Map Set WeakMap WeakSet Promise Error TypeError RangeError SyntaxError ReferenceError Reflect Proxy Intl Atomics NaN Infinity console window document globalThis process Buffer URL URLSearchParams fetch setTimeout clearTimeout setInterval clearInterval parseInt parseFloat isNaN isFinite require module exports',
 go:'append cap clear close complex copy delete imag len make max min new panic print println real recover',
 cpp:'std',
 py:'self cls print str int float bool list dict set tuple bytes bytearray range len sum min max abs round sorted enumerate zip map filter open Exception ValueError TypeError RuntimeError object super',
 java:'System Math String Integer Long Double Float Boolean Object Class Arrays Collections Optional List Map Set Stream Objects Thread Runtime',
 cs:'Console Math String Int32 Int64 Double Boolean Object Convert DateTime Guid Task Enumerable Array',
 swift:'String Int Double Float Bool Array Dictionary Set Optional Result Error DispatchQueue Date UUID',
 kotlin:'String Int Long Double Float Boolean Any Unit Nothing Array List Map Set println require check',
 rust:'String Vec Option Result Box Rc Arc Some None Ok Err Self usize isize u8 u16 u32 u64 i8 i16 i32 i64 bool',
};
// Calculate coloring and navigable identifiers together, once per side.
export function diffTokenLines(lines, side, path='') {
 const lang = sourceLanguage(path) || 'js';
 const globals = new Set((globalsByLanguage[lang] || '').split(' '));
 const included = line => side === 'old' ? line.kind !== 'add' : line.kind !== 'del';
 const declarations = lines.filter(line => line.kind !== 'hunk' && included(line)).map(line => line.text).join('\n');
 for (const match of declarations.matchAll(/\b(?:const|let|var|function|class|def|struct|interface|type|val|fun|fn)\s+([\w$]+)/g)) globals.delete(match[1]);
 let state = {};
 return lines.map(line => {
   if (line.kind === 'hunk') { state = {}; return []; }
   if (!included(line)) return [];
   let globalChain = false, previousEnd = 0;
   return scanLine(line.text, lang, state).map(token => {
     const value = line.text.slice(token.start, token.end);
     const member = /^\s*(?:\.|::|\?\.)\s*$/.test(line.text.slice(previousEnd, token.start));
     previousEnd = token.end;
     globalChain = member ? globalChain : globals.has(value);
     if (!['identifier','function','type'].includes(token.kind) || globalChain) return token;
     return {...token, name:value};
   });
 });
}
export function diffTokens(lines, side, path='') {
 return diffTokenLines(lines, side, path).flatMap((tokens, index) =>
   tokens.filter(t => t.name).map(({name, start, end}) => ({name, start, end, index})));
}
export function findDiffUsages(files,name,side){
 return files.flatMap(file => {
   const path = side === 'old' ? file.oldPath || file.path : file.path;
   const imports = diffImportRanges(file.lines,side,path);
   return diffTokens(file.lines,side,path).filter(t => t.name === name && !imports(t.index,t.start))
     .map(t => ({...t,path:file.path,id:file.id,line:side === 'old' ? file.lines[t.index].old : file.lines[t.index].new,text:file.lines[t.index].text,side}));
 });
}
// Conservative declaration evidence in the displayed diff, not symbol resolution.
export function isDiffDeclaration(result) {
 const before=result.text.slice(0,result.start),after=result.text.slice(result.end);
 if(/\b(?:return|throw|yield|new|await|import|from)\s*$/.test(before))return false;
 if(/^\s*(?:(?:public|private|protected|static|readonly|declare)\s+)*$/.test(before)&&/^\s*[?!]?\s*:\s*[A-Za-z_$][\w$<>[\].| ?]*(?:[;=}]|$)/.test(after))return true;
 if(result.path?.endsWith('.py')&&/^\s*$/.test(before)&&/^\s*(?::[^=]+)?=(?!=)/.test(after))return true;
 if(result.path?.endsWith('.go')&&/^\s*$/.test(before)&&/^\s*:=/.test(after))return true;
 if(/\b(?:class|interface|type|enum|struct|trait|protocol|function|def|fun|fn|const|let|var|val)\s+(?:\*\s*)?$/.test(before))return true;
 if(/\b(?:const|let|var)\s+[^;=]+,\s*$/.test(before)&&/^\s*(?:[:=,;]|$)/.test(after))return true;
 if(/^\s*(?:(?:export|default|public|private|protected|static|readonly|override|async|final|abstract|suspend)\s+)*$/.test(before)&&/^\s*\([^;]*\)\s*(?::[^={]+)?\s*(?:\{|=>)/.test(after))return true;
 if(/^\s*(?:(?:public|private|protected|static|readonly|final|override)\s+)*(?:[A-Za-z_$][\w$<>[\]?.]*\s+)+$/.test(before)&&/^\s*(?:\([^;]*\)\s*\{|=|;)/.test(after))return true;
 return false;
}
export function primaryDiffDeclaration(results, {path,index=Infinity} = {}) {
 const declarations=results.filter(isDiffDeclaration);
 return declarations.sort((a,b)=>{
  const rank=r=>r.path===path?(r.index<=index?0:1):2;
  return rank(a)-rank(b)||(rank(a)===0?b.index-a.index:a.path.localeCompare(b.path)||a.index-b.index);
 })[0] || null;
}

// Exclude import bindings from matches while leaving their tokens clickable.
// Ranges preserve columns, so an actual call after `import ...;` still counts.
export function diffImportRanges(lines,side,path=''){
 let masked = '', state = {};
 const offsets = new Map(), lang = sourceLanguage(path) || 'js';
 for (const [index, line] of lines.entries()) {
   if (line.kind === 'hunk') { masked += '\n;\n'; state = {}; continue; }
   if (side === 'old' ? line.kind === 'add' : line.kind === 'del') continue;
   offsets.set(index, masked.length);
   let at = 0;
   for (const {kind,start,end} of scanLine(line.text,lang,state)) {
     if (kind !== 'string' && kind !== 'comment') continue;
     masked += line.text.slice(at,start);
     const raw = line.text.slice(start,end);
     // Keep the delimiters needed to recognize import specifiers but hide the
     // contents (including import-like examples) at their original columns.
     const quote = value => kind === 'string' && /['"`]/.test(value);
     const first = quote(raw[0]) ? raw[0] : '';
     const last = raw.length > 1 && quote(raw.at(-1)) ? raw.at(-1) : '';
     masked += first + ' '.repeat(raw.length - first.length - last.length) + last;
     at = end;
   }
   masked += line.text.slice(at) + '\n';
 }
 let patterns;
 if(path.endsWith('.py'))patterns=[/\bfrom\s+[\w.]+\s+import\s+(?:\([^)]*\)|[^\n;]+)/g,/\bimport\s+[^\n;]+/g];
 else if(/\.rs$/.test(path))patterns=[/\buse\s+[^;]+;/g];
 else if(/\.go$/.test(path))patterns=[/\bimport\s*(?:\([^)]*\)|(?:[\w.]+\s+)?["'][^"'\n]*["'])/g];
 else if(path.endsWith('.cs'))patterns=[/\b(?:global\s+)?using\s+(?!\(|var\b)[^;\n]+;?/g];
 else if(/\.(?:java|kt|kts|swift|cpp|cc|cxx|h|hpp)$/.test(path))patterns=[/\bimport\s+[^;\n]+;?/g,/^[ \t]*#[ \t]*include[^\n]*/gm];
 else patterns=[/\bimport\s+(?![.(])(?:[^;"']*?\bfrom\s*)?(["'])[^\n]*?\1(?:\s*(?:with|assert)\s*\{[^}]*\})?[ \t]*;?/g,/\b(?:const|let|var|import)\s+[^;=\n]+=\s*(?:require|import)\s*\([^)]*\)[ \t]*;?/g];
 const ranges=patterns.flatMap(pattern=>[...masked.matchAll(pattern)].map(match=>[match.index,match.index+match[0].length]));
 return (index,column)=>{const offset=offsets.get(index);return offset!==undefined&&ranges.some(([start,end])=>offset+column>=start&&offset+column<end);};
}
