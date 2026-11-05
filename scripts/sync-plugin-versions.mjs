import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const {version}=JSON.parse(await readFile(new URL('package.json',root),'utf8'));
for(const name of ['.claude-plugin','.codex-plugin']){
 const path=new URL(`plugins/trace/${name}/plugin.json`,root);
 const manifest=JSON.parse(await readFile(path,'utf8'));manifest.version=version;
 manifest.description='Review local Git changes with dependency graphs, Find Usages and threaded agent feedback.';
 await writeFile(path,JSON.stringify(manifest,null,2)+'\n');
}
console.log(`Plugin manifests synchronized to ${version}`);
