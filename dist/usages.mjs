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
 return files.flatMap(file=>diffTokens(file.lines,side,file.path).filter(t=>t.name===name).map(t=>({...t,path:file.path,id:file.id,line:side==='old'?file.lines[t.index].old:file.lines[t.index].new,text:file.lines[t.index].text,side})));
}
export function usageLineHtml(text,tokens,escape){
 let offset=0,html='';for(const token of tokens){html+=escape(text.slice(offset,token.start))+`<span class="diff-symbol" tabindex="0" data-symbol="${escape(token.name)}" data-offset="${token.start}">${escape(token.name)}</span>`;offset=token.end;}return html+escape(text.slice(offset));
}
