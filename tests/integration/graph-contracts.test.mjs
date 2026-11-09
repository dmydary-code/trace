import test from '../support/test.mjs';
import assert from 'node:assert/strict';
import {fixture,session,post,eventually} from '../support/harness.mjs';
import {openRepository} from '../../lib/git.mjs';
import {buildGraph} from '../../lib/graph.mjs';
const setup=async t=>{const f=await fixture();t.after(()=>f.dispose());return f;};
const graph=async f=>buildGraph(f.repo,await(await openRepository(f.repo)).snapshot());
const edge=(g,a,b,kind)=>g.edges.find(e=>e.source===a&&e.target===b&&e.kind===kind);
test('G-02/03/05 stable imports/calls and explicit added/removed relations',async t=>{
 const f=await setup(t);await f.put('src/pricing.js',"import { subtotal } from './subtotal.js';\nexport { subtotal };\nexport function total(items) { return subtotal(items); }\n");await f.put('src/unused.js','export const unused=1;\n');await f.git('add','.');await f.git('commit','-m','graph base');
 await f.put('src/pricing.js',"import { subtotal } from './subtotal.js';\nimport { unused } from './unused.js';\nexport function total(items) { return items.length + unused; }\n");const g=await graph(f);
 assert.equal(edge(g,'src/pricing.js','src/subtotal.js','Imports').change,null);assert.equal(edge(g,'src/pricing.js','src/subtotal.js','Calls').change,'−');assert.equal(edge(g,'src/pricing.js','src/unused.js','Imports').change,'+');assert(!edge(g,'src/pricing.js','src/unused.js','Calls'));
});
test('G-02 CommonJS and re-export resolve relative targets; externals and missing files excluded',async t=>{
 const f=await setup(t);await f.put('src/consumer.cjs',"const x = require('./subtotal.js');\nrequire('node:fs');\nrequire('./absent');\n");await f.put('src/barrel.js',"export { subtotal } from './subtotal.js';\n");const g=await graph(f);
 assert(edge(g,'src/consumer.cjs','src/subtotal.js','Imports'));assert(edge(g,'src/barrel.js','src/subtotal.js','Imports'));assert(!g.edges.some(e=>e.target==='node:fs'||e.target.includes('absent')));
});
test('G-04/06/07/08/09 types, multiple test targets and explicit role mapping',async t=>{
 const f=await fixture('typescript');t.after(()=>f.dispose());await f.put('src/other.ts','export function other() {}\n');await f.put('src/folder/index.ts','export function nested() {}\n');
 await f.put('tests/unit/multi.test.ts',"import { subtotal } from '../../src/subtotal.js';\nimport { other } from '../../src/other';\nsubtotal([]); other();\n");
 for(const [dir,name] of [['integration','integration'],['e2e','scenario']])await f.put('tests/'+dir+'/'+name+'.ts',"import { other } from '../../src/other'; other();\n");await f.put('ambiguous.test.ts','export const value=1;\n');
 await f.put('src/consumer.ts',"import { nested } from './folder'; nested();\n");const g=await graph(f);
 assert(edge(g,'src/pricing.ts','src/types.ts','Uses type'));assert.equal(g.nodes.find(n=>n.path===f.project.testPath).changed,false);
 assert.deepEqual(g.edges.filter(e=>e.source==='tests/unit/multi.test.ts'&&e.kind==='Calls').map(e=>e.target).sort(),['src/other.ts','src/subtotal.ts']);
 for(const [path,role] of [['tests/unit/multi.test.ts','unit'],['tests/integration/integration.ts','integration'],['tests/e2e/scenario.ts','e2e'],['ambiguous.test.ts','test']])assert.equal(g.nodes.find(n=>n.path===path).test,role);
 assert(edge(g,'src/consumer.ts','src/folder/index.ts','Imports'));
});
test('G-10 deleted source and a renamed file use the reviewed versions',async t=>{
 const f=await setup(t);await f.git('mv','src/subtotal.js','src/renamed.js');await f.put(f.project.path,f.project.after.replace('./subtotal.js','./renamed.js'));const g=await graph(f);
 assert.equal(g.nodes.filter(n=>n.oldPath==='src/subtotal.js').length,1);assert(!g.nodes.some(n=>n.path==='src/subtotal.js'));assert(g.edges.some(e=>e.target==='src/renamed.js'));
 await f.git('reset','--hard','HEAD');await (await import('node:fs/promises')).rm(f.repo+'/src/subtotal.js');const deleted=await graph(f);assert.equal(deleted.sources['src/subtotal.js'],f.project.files['src/subtotal.js']);
});
test('G-11 staged Graph source and edges come from the index, not working files',async t=>{
 const f=await setup(t);await f.git('add','.');await f.put(f.project.path,"export const unrelated=7;\n");const s=await(await openRepository(f.repo,{staged:true})).snapshot();const g=await buildGraph(f.repo,s);
 assert.equal(g.sources[f.project.path],f.project.after);assert(edge(g,f.project.path,'src/subtotal.js','Imports'));
});
test('G-13 cycles, diamonds, disconnected files and other languages retain actual topology',async t=>{
 const f=await setup(t);for(const [name,body] of Object.entries({'a.js':"import './b.js'; import './c.js';\n",'b.js':"import './d.js';\n",'c.js':"import './d.js';\n",'d.js':"import './a.js';\n",'alone.rs':'pub fn alone() {}\n'}))await f.put('topology/'+name,body);
 const g=await graph(f);for(const [a,b] of [['a','b'],['a','c'],['b','d'],['c','d'],['d','a']])assert(edge(g,'topology/'+a+'.js','topology/'+b+'.js','Imports'));assert(g.nodes.some(n=>n.path==='topology/alone.rs'));assert(!g.edges.some(e=>e.source.endsWith('.rs')));
});
test('G-16/N-06 diff remains usable while Graph builds, rejects, coalesces and retries',async t=>{
 const f=await setup(t);let finish,calls=0;const app=await f.server({graphBuilder:()=>{calls++;return new Promise((ok,fail)=>finish={ok,fail});}});const s=await session(app);assert.equal(calls,0);
 const url=app.url+'/api/graph?revision='+s.revision;const first=fetch(url),second=fetch(url);await eventually(()=>finish);assert.equal((await session(app)).revision,s.revision);assert.equal(calls,1);finish.fail(Error('Injected graph failure'));assert.equal((await first).status,400);assert.equal((await second).status,400);
 finish=null;const retry=fetch(url);await eventually(()=>finish);assert.equal(calls,2);finish.ok({nodes:[],edges:[],sources:{}});assert.equal((await retry).status,200);assert.equal((await fetch(url)).status,200);assert.equal(calls,2);assert.equal((await fetch(app.url+'/api/graph?revision=stale')).status,409);
});
test('G-17 historical review refuses to build Graph from a different working tree',async t=>{
 const f=await setup(t);const app=await f.server(),s=await session(app);assert.equal((await post(app,s,undefined,{instruction:'Include shipping'})).status,201);await f.put(f.project.path,f.project.fixed);
 const res=await fetch(app.url+'/api/graph?revision='+s.revision);assert.equal(res.status,409);assert.match((await res.json()).error,/saved review differs/);
});
