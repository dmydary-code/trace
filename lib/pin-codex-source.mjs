import {readFile,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';import {join} from 'node:path';
export async function pinCodexSource(source,canonical,{file=join(process.env.CODEX_HOME||join(homedir(),'.codex'),'config.toml')}={}){
 const text=await readFile(file,'utf8');
 const section=/^\[marketplaces\.trace-tools\][^]*?(?=^\[|$(?![^]))/m;
 const match=text.match(section);if(!match)throw new Error('Cannot locate trace-tools in Codex configuration');
 const value=match[0].match(/^source\s*=\s*("(?:[^"\\]|\\.)*")[ \t]*$/m);
 if(!value)throw new Error('Cannot verify Codex marketplace source');
 const current=JSON.parse(value[1]);
 if(current===source)return;
 if(current!==await canonical(source))throw new Error(`Unexpected Codex source ${current}; refusing to rewrite it`);
 const updated=match[0].replace(value[0],`source = ${JSON.stringify(source)}`);
 await writeFile(file,text.slice(0,match.index)+updated+text.slice(match.index+match[0].length));
}
