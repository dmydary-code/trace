import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {pinCodexSource} from '../lib/pin-codex-source.mjs';
test('pin only the verified Trace marketplace and preserve other settings',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'trace-pin-'));const file=join(dir,'config.toml');
 const source='/opt/homebrew/opt/trace-review/libexec',resolved='/opt/homebrew/Cellar/trace-review/0.5.0/libexec';
 const suffix='[plugins."trace@trace-tools"]\nenabled = true\n';
 try{await writeFile(file,'model = "example"\n[marketplaces.trace-tools]\nsource_type = "local"\nsource = "'+resolved+'"\n'+suffix);
 await pinCodexSource(source,async()=>resolved,{file});const text=await readFile(file,'utf8');assert(text.includes('source = "'+source+'"'));assert(text.endsWith('\n'+suffix));assert(text.startsWith('model = "example"'));
 await writeFile(file,'[marketplaces.trace-tools]\nsource = "/unrelated"\n');await assert.rejects(pinCodexSource(source,async()=>resolved,{file}),/refusing/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
