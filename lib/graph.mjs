import {gitOutput} from './git-command.mjs';
import {readFile, realpath} from 'node:fs/promises';
import {resolve, posix, sep} from 'node:path';
const blobCache=new Map();
export async function buildGraph(repo, snapshot, {runner=gitOutput}={}) {
  const git=(repo,...args)=>runner(['--literal-pathspecs','-C',repo,...args]);
  repo = await realpath(repo);
  const base = snapshot.baseRevision;
  const paths = [...new Set([...(await git(repo, 'ls-files', '-z')).split('\0'), ...snapshot.files.map(f => f.path)])].filter(Boolean);
  const beforePaths = (await git(repo, 'ls-tree', '-r', '--name-only', '-z', base).catch(() => '')).split('\0').filter(Boolean);
  let config = {};
  try { config = JSON.parse(await readFile(resolve(repo, '.trace-graph.json'), 'utf8')); } catch {}
  const changed = new Map(snapshot.files.map(f => [f.path, f]));
  const aliases = new Map(snapshot.files.filter(f => f.oldPath).map(f => [f.oldPath, f.path]));
  const canonical = p => aliases.get(p) || p;
  const texts = {before: new Map(), after: new Map()};
  async function gitTexts(version){
    const listing=version==='before'?await git(repo,'ls-tree','-r','-z',base).catch(()=>''):await git(repo,'ls-files','--stage','-z');
    const entries=listing.split('\0').filter(Boolean).map(record=>{const tab=record.indexOf('\t');const parts=record.slice(0,tab).split(' ');return {path:record.slice(tab+1),oid:parts[1]==='blob'?parts[2]:parts[1],mode:parts[0]};}).filter(e=>/^100/.test(e.mode));
    const missing=[...new Set(entries.map(e=>e.oid))].filter(oid=>!blobCache.has(oid));
    const invoke=(args,input,binary=false)=>runner(['-C',repo,...args],{input,binary});
    if(missing.length){
      const sizes=(await invoke(['cat-file','--batch-check=%(objectname) %(objecttype) %(objectsize)'],missing.join('\n')+'\n')).trim().split('\n');
      const accepted=sizes.filter(line=>{const [,type,size]=line.split(' ');return type==='blob' && +size<=1024*1024;}).map(line=>line.split(' ')[0]);
      for(const oid of missing)if(!accepted.includes(oid))blobCache.set(oid,null);
      // Bound each response; one batch replaces hundreds of git show processes.
      for(let i=0;i<accepted.length;i+=24){
        const buffer=await invoke(['cat-file','--batch'],accepted.slice(i,i+24).join('\n')+'\n',true);let offset=0;
        while(offset<buffer.length){const end=buffer.indexOf(10,offset);const [oid,,size]=buffer.subarray(offset,end).toString().split(' ');offset=end+1;const bytes=buffer.subarray(offset,offset+Number(size));blobCache.set(oid,bytes.includes(0)?null:bytes.toString('utf8'));offset+=Number(size)+1;}
      }
    }
    const result=new Map(entries.map(e=>[e.path,blobCache.get(e.oid)]).filter(([,text])=>typeof text==='string'));
    if(blobCache.size>5000 || [...blobCache.values()].reduce((size,text)=>size+(text?.length||0),0)>32*1024*1024)blobCache.clear();
    return result;
  }
  texts.before=await gitTexts('before');
  if(snapshot.comparison==='staged')texts.after=await gitTexts('after');
  else {
    let cursor=0;
    await Promise.all(Array.from({length:8},async()=>{while(cursor<paths.length){const path=paths[cursor++];try{const absolute=await realpath(resolve(repo,path));if(!absolute.startsWith(repo+sep))continue;const text=await readFile(absolute,'utf8');if(text.length<=1024*1024&&!text.includes('\0'))texts.after.set(path,text);}catch{}}}));
  }
  function edges(texts) {
    const result = new Map();
    for (const [path, text] of texts) {
      if (!/\.[cm]?[jt]sx?$/.test(path)) continue;
      const imports = /\b(import|export)\s+(type\s+)?([^;\n]*?)\s+from\s*['"]([^'"]+)['"]|\b(?:import\s*|require\s*\()(['"])([^'"]+)\5/g;
      for (const match of text.matchAll(imports)) {
        const spec = match[4] || match[6];
        if (!spec.startsWith('.')) continue;
        const stem = posix.normalize(posix.join(posix.dirname(path), spec));
        const candidates = [stem, ...['.ts','.tsx','.js','.jsx','.mjs','.cjs','/index.ts','/index.tsx','/index.js'].map(ext => stem + ext), stem.replace(/\.js$/, '.ts'), stem.replace(/\.js$/, '.tsx')];
        const target = candidates.find(p => texts.has(p));
        if (!target || canonical(target) === canonical(path)) continue;
        const add = kind => {const e = {source:canonical(path), target:canonical(target), kind}; result.set(JSON.stringify(e), e);};
        add(match[2] ? 'Uses type' : 'Imports');
        const bindings = (match[3] || '').match(/[A-Za-z_$][\w$]*/g) || [];
        const body = text.slice(0, match.index) + text.slice(match.index + match[0].length);
        if (!match[2] && bindings.some(name => !['as','type'].includes(name) && new RegExp('\\b' + name.replace(/\$/g,'\\$') + '\\s*\\(').test(body))) add('Calls');
      }
    }
    return result;
  }
  const before = edges(texts.before), after = edges(texts.after);
  const all = new Map([...before, ...after]);
  const edgesList = [...all].map(([key,e]) => ({...e, change:!before.has(key) ? '+' : !after.has(key) ? '−' : null}));
  const allPaths = [...new Set([...paths, ...snapshot.files.map(f=>f.path)])];
  const nodes = allPaths.map(path => {
    const f = changed.get(path);
    // Explicit directory conventions only; generic .test files stay unclassified.
    const configured = Object.entries(config.testDirectories || {}).find(([kind, dirs]) => ['unit','integration','e2e'].includes(kind) && Array.isArray(dirs) && dirs.some(dir => typeof dir === 'string' && path.startsWith(dir.replace(/\/$/, '') + '/')))?.[0];
    const test = configured || (/(?:^|\/)(?:e2e|__e2e__)\//.test(path) ? 'e2e' : /(?:^|\/)(?:integration|__integration__)\//.test(path) ? 'integration' : /(?:^|\/)(?:unit|__unit__)\//.test(path) ? 'unit' : /(?:test|spec)[./]|__tests__/.test(path) ? 'test' : 'code');
    const icon = test !== 'code' ? '⚗' : /(?:types?|contracts?)[/.]/i.test(path) ? '{}' : /migration|\.sql$/i.test(path) ? '▤' : /config|package\.json|lock$/i.test(path) ? '⚙' : /\.(md|png|svg|jpg)$/i.test(path) ? '▧' : '‹›';
    return {path, changed:!!f, status:f?.status, oldPath:f?.oldPath, test, icon};
  });
  return {nodes, edges:edgesList, sources:Object.fromEntries(nodes.map(n => [n.path, texts.after.get(n.path) ?? texts.before.get(n.oldPath || n.path) ?? null]))};
}
