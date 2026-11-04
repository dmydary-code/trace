// Tokenize source lines without matching identifiers inside strings or comments.
export function diffTokens(lines, side) {
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
   if(match && !new Set(['import','from','export','return','const','let','var','function','class','interface','type','if','else','new','await','async','throw','try','catch','for','while','true','false','null','undefined','extends','implements','public','private','protected','static','readonly','default','typeof','void','this','super']).has(match[0])){result.push({name:match[0],index,start:i,end:i+match[0].length});i+=match[0].length;}else i+=match?match[0].length:1;
  }
 }
 return result;
}
export function findDiffUsages(files,name,side){
 return files.flatMap(file=>diffTokens(file.lines,side).filter(t=>t.name===name).map(t=>({...t,path:file.path,id:file.id,line:side==='old'?file.lines[t.index].old:file.lines[t.index].new,text:file.lines[t.index].text,side})));
}
export function usageLineHtml(text,tokens,escape){
 let offset=0,html='';for(const token of tokens){html+=escape(text.slice(offset,token.start))+`<span class="diff-symbol" tabindex="0" data-symbol="${escape(token.name)}" data-offset="${token.start}">${escape(token.name)}</span>`;offset=token.end;}return html+escape(text.slice(offset));
}
