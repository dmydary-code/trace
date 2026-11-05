import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
test('both plugin manifests match the CLI release version',async()=>{
 const root=new URL('../',import.meta.url),read=async path=>JSON.parse(await readFile(new URL(path,root),'utf8'));
 const cli=await read('package.json');
 for(const name of ['.claude-plugin','.codex-plugin'])assert.equal((await read(`plugins/trace/${name}/plugin.json`)).version,cli.version);
 assert.match(cli.scripts.version,/sync-plugin-versions/);
});
