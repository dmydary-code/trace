import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gitOutput} from '../lib/git-command.mjs';
import {openRepository} from '../lib/git.mjs';
import {buildGraph} from '../lib/graph.mjs';
test('graph compares dependencies and retains unchanged context and deleted source', async () => {
 const repo=await mkdtemp(join(tmpdir(),'trace-graph-'));
 const git=(...args)=>gitOutput(['-C',repo,...args]);
 try {
 await git('init'); await git('config','user.name','Test'); await git('config','user.email','test@example.com');
 await writeFile(join(repo,'main.ts'),"import {a} from './a'; a();\n");
 await writeFile(join(repo,'a.ts'),'export function a() {}\n');
 await writeFile(join(repo,'b.ts'),'export type B = string;\n');
 await git('add','.'); await git('commit','-m','base');
 await writeFile(join(repo,'main.ts'),"import type {B} from './b';\n");
 await rm(join(repo,'a.ts'));
 const repository=await openRepository(repo); const graph=await buildGraph(repo,await repository.snapshot());
 assert(graph.edges.some(e=>e.target==='a.ts' && e.kind==='Calls' && e.change==='−'));
 assert(graph.edges.some(e=>e.target==='b.ts' && e.kind==='Uses type' && e.change==='+'));
 assert.equal(graph.nodes.find(n=>n.path==='b.ts').changed,false);
 assert.match(graph.sources['a.ts'],/function a/);
 } finally {await rm(repo,{recursive:true,force:true});}
});
