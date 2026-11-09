import test from 'node:test';
import assert from 'node:assert/strict';
import {fileTreeOrder,compactFileTree} from '../dist/core.mjs';
import {diffTokens,findDiffUsages,primaryDiffDeclaration} from '../dist/usages.mjs';
import {browserPresence} from '../lib/session-lifecycle.mjs';
test('file feed follows the same depth-first order as the sidebar',()=>{
 const files=['src.ts','src/a.ts','src/nested/b.ts','src-helpers.ts','README.md','a.ts'].map(path=>({path}));
 const flatten=nodes=>nodes.flatMap(n=>n.file?[n.file.path]:flatten(n.children));
 assert.deepEqual(fileTreeOrder(files).map(f=>f.path),flatten(compactFileTree(files)));
 assert.deepEqual(fileTreeOrder(files,'SRC').map(f=>f.path),flatten(compactFileTree(files.filter(f=>f.path.toLowerCase().includes('src')))));
});
test('primary declaration is a definition, never an import or first call',()=>{
 const files=[{id:'a',path:'a.ts',lines:[{kind:'add',text:'import { total } from "./b";',new:1},{kind:'add',text:'total(items);',new:2}]},{id:'b',path:'b.ts',lines:[{kind:'add',text:'export function total(items: number[]) {',new:1}]}];
 const matches=findDiffUsages(files,'total','new');assert.equal(primaryDiffDeclaration(matches,{path:'a.ts',index:1}).path,'b.ts');
 assert.equal(primaryDiffDeclaration(matches.filter(r=>r.path==='a.ts')),null);
});
for(const text of ['export const total = 1;','class total {}','type total = number;','  total(items: number[]): number {','public static int total(int n) {','def total(items):','fun total(items: List<Int>) {','fn total() {'])test('declaration evidence: '+text,()=>{
 const matches=findDiffUsages([{id:'file',path:'file.ts',lines:[{kind:'add',text,new:1}]}],'total','new');assert.equal(primaryDiffDeclaration(matches)?.name,'total');
});
test('same-file preceding declaration wins without combining opposite diff sides',()=>{
 const file={id:'a',path:'a.ts',lines:[{kind:'del',text:'const total = old;',old:1},{kind:'add',text:'const total = current;',new:1},{kind:'add',text:'total();',new:2}]};
 const result=primaryDiffDeclaration(findDiffUsages([file],'total','new'),{path:'a.ts',index:2});assert.equal(result.text,'const total = current;');assert.equal(result.side,'new');
});
test('browser presence is refreshed by activity and closes on inactivity once',async()=>{
 let now=0,closed=0;const lease=browserPresence(()=>{closed++;},{timeout:100,interval:5,now:()=>now});lease.start();now=90;lease.touch();now=150;await new Promise(r=>setTimeout(r,15));assert.equal(closed,0);now=200;await new Promise(r=>setTimeout(r,15));assert.equal(closed,1);lease.stop();
});
for(const [path,text] of [['a.ts','return total;'],['a.ts','throw total;'],['a.ts','import total from "lib";']])test('reference is not a declaration: '+text,()=>{
 const results=findDiffUsages([{id:'a',path,lines:[{kind:'add',text,new:1}]}],'total','new');assert.equal(primaryDiffDeclaration(results),null);
});
for(const [path,text] of [['a.ts','readonly total: number;'],['a.py','total = amount'],['a.go','total := amount']])test('native declaration evidence: '+text,()=>{
 const results=findDiffUsages([{id:'a',path,lines:[{kind:'add',text,new:1}]}],'total','new');assert.equal(primaryDiffDeclaration(results)?.name,'total');
});
test('session inference refuses ambiguous ownership',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');const {ownedSessionLease}=await import('../plugins/trace/hooks/session.mjs');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'trace-owner-test-'));const previous=process.env.TRACE_SESSION_DIRECTORY;process.env.TRACE_SESSION_DIRECTORY=dir;
 try{
  assert.equal(await ownedSessionLease(123),null);await fs.writeFile(path.join(dir,'one.json'),JSON.stringify({ownerPid:123,token:'one'}));assert.equal((await ownedSessionLease(123)).token,'one');await fs.writeFile(path.join(dir,'two.json'),JSON.stringify({ownerPid:123,token:'two'}));assert.equal(await ownedSessionLease(123),null);assert.equal(await ownedSessionLease(null),null);
 }finally{if(previous===undefined)delete process.env.TRACE_SESSION_DIRECTORY;else process.env.TRACE_SESSION_DIRECTORY=previous;await fs.rm(dir,{recursive:true,force:true});}
});
for(const [path,lines] of [
 ['file.ts',['import { total } from "./pricing";','total();']],
 ['file.ts',['import {','  total as localTotal,','} from "./pricing";','total();']],
 ['file.ts',['import type { total } from "./types";','total();']],
 ['file.js',['const { total } = require("./pricing");','total();']],
 ['file.py',['from pricing import (','    total,',')','total()']],
 ['file.java',['import static fixture.Pricing.total;','total();']],
 ['file.kt',['import fixture.total','total()']],
 ['file.rs',['use pricing::{',' total,','};','total();']],
 ['file.swift',['import total','total()']],
 ['file.go',['import (',' total "example.invalid/pricing"',')','total()']],
])test('imports are not usages: '+path+' '+lines[0],()=>{
 const file={id:'file',path,lines:lines.map((text,i)=>({kind:'add',text,new:i+1}))};const results=findDiffUsages([file],'total','new');assert.deepEqual(results.map(r=>r.line),[lines.length]);assert(diffTokens(file.lines,'new',path).filter(t=>t.name==='total').length>=2);
});
test('a real use on the same line as import is preserved, with opposite sides isolated',()=>{
 const file={id:'f',path:'a.ts',lines:[{kind:'del',old:1,text:'import { total } from "./old"; total(old);'},{kind:'add',new:1,text:'import { total } from "./new"; total(next);'}]};
 for(const side of ['old','new']){const results=findDiffUsages([file],'total',side);assert.equal(results.length,1);assert.equal(results[0].start,results[0].text.lastIndexOf('total'));}
});
