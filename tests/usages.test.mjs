import test from 'node:test';import assert from 'node:assert/strict';
import {findDiffUsages,diffTokens} from '../dist/usages.mjs';
test('diff usages exclude opposite side, strings, comments and substring matches',()=>{
 const files=[{id:'a',path:'a.ts',lines:[{kind:'del',text:'run(old);',old:1},{kind:'add',text:'run(next);',new:1},{kind:'context',text:'runner(); // run()',old:2,new:2},{kind:'context',text:'"run"; /* run */ run();',old:3,new:3}]},{id:'b',path:'b.ts',lines:[{kind:'add',text:'run();',new:1}]}];
 assert.deepEqual(findDiffUsages(files,'run','old').map(r=>r.path),['a.ts','a.ts']);
 assert.deepEqual(findDiffUsages(files,'run','new').map(r=>r.path),['a.ts','a.ts','b.ts']);
 assert.equal(diffTokens([{kind:'context',text:'/* foo',old:1,new:1},{kind:'context',text:'foo */ bar()',old:2,new:2}],'new')[0].name,'bar');
});
test('standard globals, static members and syntax are not clickable; local declarations survive',()=>{
 const lines=text=>[{kind:'add',text,new:1}];
 assert.deepEqual(diffTokens(lines('return Math.round(total) + JSON.parse(raw);'),'new','a.ts').map(t=>t.name),['total','raw']);
 assert.deepEqual(diffTokens(lines('System.out.println(value);'),'new','A.java').map(t=>t.name),['value']);
 assert.deepEqual(diffTokens(lines('class Math {}'),'new','a.ts').map(t=>t.name),['Math']);
 assert.deepEqual(diffTokens(lines('return len(items)'),'new','a.py').map(t=>t.name),['items']);
});
