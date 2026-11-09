const syntax=new Set('import from export return const let var function class interface type if else new await async throw try catch for while true false null undefined extends implements public private protected static readonly default typeof void this super switch case break continue do finally delete in instanceof of yield as enum namespace declare abstract override constructor def lambda pass raise except with self cls None True False and or not is elif global nonlocal assert del print package func struct impl trait fn pub use mod mut match let val fun when object companion internal sealed data suspend where get set by init nil guard defer protocol extension associatedtype final some any throws rethrows operator inout'.split(' '));
const globalsByLanguage={
 js:'Math JSON Object Array String Number Boolean BigInt Symbol Date RegExp Map Set WeakMap WeakSet Promise Error TypeError RangeError SyntaxError ReferenceError Reflect Proxy Intl Atomics NaN Infinity console window document globalThis process Buffer URL URLSearchParams fetch setTimeout clearTimeout setInterval clearInterval parseInt parseFloat isNaN isFinite require module exports',
 py:'str int float bool list dict set tuple bytes bytearray range len sum min max abs round sorted enumerate zip map filter open Exception ValueError TypeError RuntimeError object super',
 java:'System Math String Integer Long Double Float Boolean Object Class Arrays Collections Optional List Map Set Stream Objects Thread Runtime',
 cs:'Console Math String Int32 Int64 Double Boolean Object Convert DateTime Guid Task Enumerable Array',
 swift:'String Int Double Float Bool Array Dictionary Set Optional Result Error DispatchQueue Date UUID',
 kotlin:'String Int Long Double Float Boolean Any Unit Nothing Array List Map Set println require check',
 rust:'String Vec Option Result Box Rc Arc Some None Ok Err Self usize isize u8 u16 u32 u64 i8 i16 i32 i64 bool',
};
function language(path){return /\.py$/.test(path)?'py':/\.java$/.test(path)?'java':/\.cs$/.test(path)?'cs':/\.swift$/.test(path)?'swift':/\.kts?$/.test(path)?'kotlin':/\.rs$/.test(path)?'rust':'js';}
// Tokenize source lines without matching identifiers inside strings or comments.
export function diffTokens(lines, side, path='') {
 const globals=new Set(globalsByLanguage[language(path)].split(' '));
 const declarations=lines.filter(l=>l.kind!=='hunk' && (side==='old'?l.kind!=='add':l.kind!=='del')).map(l=>l.text).join('\n');
 for(const name of globals)if(new RegExp('\\b(?:const|let|var|function|class|def|struct|interface|type|val|fun|fn)\\s+'+name+'\\b').test(declarations))globals.delete(name);
 let block=false;const result=[];
 for(let index=0;index<lines.length;index++){
  const line=lines[index];if(line.kind==='hunk'||(side==='old'?line.kind==='add':line.kind==='del'))continue;
  const text=line.text;let quote=null;
  for(let i=0;i<text.length;){
   if(block){const end=text.indexOf('*/',i);if(end<0)break;block=false;i=end+2;continue;}
   if(quote){if(text[i]==='\\'){i+=2;continue;}if(text[i]===quote)quote=null;i++;continue;}
   if(text.startsWith('//',i))break;
   if(text.startsWith('/*',i)){block=true;i+=2;continue;}
   if(['"',"'",'`'].includes(text[i])){quote=text[i++];continue;}
   const match=/^[A-Za-z_$][\w$]*/.exec(text.slice(i));
   if(match && !syntax.has(match[0]) && !globals.has(match[0]) && ![...globals].some(name=>new RegExp('\\b'+name+'(?:\\s*\\.\\s*[A-Za-z_$][\\w$]*)*\\s*\\.\\s*$').test(text.slice(0,i)))){result.push({name:match[0],index,start:i,end:i+match[0].length});i+=match[0].length;}else i+=match?match[0].length:1;
  }
 }
 return result;
}
export function findDiffUsages(files,name,side){
 return files.flatMap(file=>{const imports=diffImportRanges(file.lines,side,file.path);return diffTokens(file.lines,side,file.path).filter(t=>t.name===name&&!imports(t.index,t.start)).map(t=>({...t,path:file.path,id:file.id,line:side==='old'?file.lines[t.index].old:file.lines[t.index].new,text:file.lines[t.index].text,side}));});
}
export function usageLineHtml(text,tokens,escape){
 let offset=0,html='';for(const token of tokens){html+=escape(text.slice(offset,token.start))+`<span class="diff-symbol" tabindex="0" data-symbol="${escape(token.name)}" data-offset="${token.start}">${escape(token.name)}</span>`;offset=token.end;}return html+escape(text.slice(offset));
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
 let source='';const offsets=new Map();
 for(let index=0;index<lines.length;index++){
  const line=lines[index];if(line.kind==='hunk'){source+='\n;\n';continue;}
  if(side==='old'?line.kind==='add':line.kind==='del')continue;
  offsets.set(index,source.length);source+=line.text+'\n';
 }
 let masked='',quote=null,block=false;
 for(let i=0;i<source.length;i++){
  const c=source[i],next=source[i+1];
  if(block){if(c==='*'&&next==='/'){masked+='  ';i++;block=false;}else masked+=c==='\n'?'\n':' ';continue;}
  if(quote){if(c==='\\'){masked+='  ';i++;}else if(c===quote){masked+=c;quote=null;}else masked+=c==='\n'?'\n':' ';continue;}
  if(c==='/'&&next==='*'){masked+='  ';i++;block=true;continue;}
  if(c==='/'&&next==='/' || c==='#'&&path.endsWith('.py')){while(i<source.length&&source[i]!=='\n'){masked+=' ';i++;}masked+='\n';continue;}
  if(['"',"'",'`'].includes(c)){quote=c;masked+=c;continue;}
  masked+=c;
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
