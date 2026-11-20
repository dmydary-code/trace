import test from 'node:test';import assert from 'node:assert/strict';
import {findDiffUsages,diffTokens,diffTokenLines} from '../dist/usages.mjs';
import {scanLine,sourceHtml,tokenHtml} from '../dist/syntax.mjs';
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

test('syntax colors preserve escaped source, UTF-16 offsets and native names', () => {
 const text = 'return "🐍<code>&" + match_fee(42) + функция(amount) # price';
 const escape = value => value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
 const [tokens] = diffTokenLines([{kind:'add',text}], 'new','prices.py');
 const html = tokenHtml(text,tokens,escape);
 assert.equal(html.replace(/<\/?span\b[^>]*>/g,''),escape(text));
 for (const kind of ['keyword','number','string','comment','function']) assert(html.includes('syn-' + kind));
 for (const name of ['match_fee','функция','amount']) {
   assert(html.includes(`data-symbol="${name}" data-offset="${text.indexOf(name)}"`));
 }
 assert.equal(sourceHtml(text,'notes.txt',escape),escape(text));
 assert.equal(scanLine('class', 'py', {})[0].kind,'keyword');
 assert.equal(scanLine('None','js',{})[0].kind,'type');
 assert.deepEqual(diffTokens([{kind:'add',text:'return package // size'}],'new','cost.py').map(t => t.name),['package','size']);
});

test('diff lexer carries state on each side and resets at omitted hunk boundaries', () => {
 const lines = [
   {kind:'del',text:'summary = """'},
   {kind:'add',text:'amount = 15'},
   {kind:'context',text:'lookup(amount)'},
   {kind:'hunk',text:'@@ ... @@'},
   {kind:'context',text:'lookup(next_value)'},
 ];
 const old = diffTokenLines(lines,'old','prices.py');
 assert.deepEqual(old[2].map(t => t.kind), ['string']);
 assert.equal(old[4][0].name,'lookup');
 assert.equal(diffTokenLines(lines,'new','prices.py')[2][0].name,'lookup');
 const files = [{id:'r',path:'new.ts',oldPath:'old.py',lines:[{kind:'del',old:1,text:'return amount // divisor # example'}]}];
 assert.equal(findDiffUsages(files,'divisor','old').length,1);
 assert.equal(findDiffUsages(files,'example','old').length,0);
});
