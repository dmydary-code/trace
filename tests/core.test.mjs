import test from 'node:test';
import assert from 'node:assert/strict';
import {classify,orderedFiles,parseDiff,reviewPrompt,changeSections} from '../dist/core.mjs';
import {demos} from './fixtures/demo.mjs';
test('route reorders files by responsibility and keeps every file',()=>{
 const source=demos.backend;const routed=orderedFiles(source,'backend','route');
 assert.deepEqual(routed.map(f=>f.path),['contracts/checkout.ts','services/checkout.ts','controllers/checkout.ts','tests/checkout.test.ts']);
 assert.equal(new Set(routed.map(f=>f.path)).size,source.length);
 assert.equal(orderedFiles(source,'backend','files')[1].path,'controllers/checkout.ts');
 assert.equal(orderedFiles(source,'backend','route',{'tests/checkout.test.ts':'Contract'})[1].path,'tests/checkout.test.ts');
});
test('frontend and mobile responsibilities, tests before broad model matching',()=>{
 assert.equal(classify('src/hooks/usePromo.ts','frontend'),'State & logic');
 assert.equal(classify('src/pages/Checkout.tsx','frontend'),'Pages & navigation');
 assert.equal(classify('app/presentation/CheckoutViewModel.kt','mobile'),'Screen state');
 assert.equal(classify('app/tests/ApplyPromoTest.kt','mobile'),'Tests');
 assert.equal(classify('README.md','mobile'),'Other changes');
});
test('diff anchors distinguish deleted and added sides across hunks',()=>{
 const [f]=parseDiff('diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -4,2 +4,3 @@\n-old\n+new\n+extra\n same\n@@ -20 +21 @@\n-last\n+replacement\n');
 assert.equal(f.path,'a.ts');assert.deepEqual(f.lines[1],{kind:'del',text:'old',old:4,new:null});
 assert.deepEqual(f.lines[2],{kind:'add',text:'new',old:null,new:4});assert.equal(f.lines.at(-1).new,21);
});
test('deleted files retain their original path',()=>{
 const [f]=parseDiff('diff --git a/old.ts b/old.ts\n--- a/old.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n');assert.equal(f.path,'old.ts');assert.equal(f.lines[1].old,1);
});
test('agent prompt includes exact file, revision and old/new side',()=>{
 const prompt=reviewPrompt({revision:'abc',comments:[{path:'a.ts',line:4,side:'old',code:'old',body:'Clarify validation'}]});
 assert.match(prompt,/a.ts:4/);assert.match(prompt,/deleted/);assert.match(prompt,/abc/);
});
test('framework and architecture presets classify conventions without dropping unknowns',()=>{
 assert.equal(classify('src/components/PromoField.vue','frontend','vue'),'Components & styles');
 assert.equal(classify('src/composables/usePromo.ts','frontend','vue'),'Composables & stores');
 assert.equal(classify('src/app/promo-api.service.ts','frontend','angular'),'Data & API');
 assert.equal(classify('src/app/promo.ts','frontend','angular','feature','@Component({})'),'Components & styles');
 assert.equal(classify('app/domain/order.py','backend','fastapi','clean'),'Domain & contracts');
 assert.equal(classify('src/events/order.event.ts','backend','nestjs','events'),'Event contracts');
 assert.equal(classify('src/consumer/order.ts','backend','nestjs','events'),'Consumers');
 assert.equal(classify('src/OrderReducer.kt','mobile','android','udf'),'Actions & reducers');
});

test('route navigation contains only touched stages and keeps package boundaries', () => {
 const source = [
  {path:'web/tests/cart.test.ts',route:{group:'web · React',layer:'Tests',rank:4}},
  {path:'web/src/hooks/useCart.ts',route:{group:'web · React',layer:'Hooks & state',rank:1}},
  {path:'api/cart.service.ts',route:{group:'api · NestJS',layer:'Implementation',rank:1}},
 ];
 const sections = changeSections(source);
 assert.deepEqual(sections.map(s => s.layer), ['Implementation', 'Hooks & state', 'Tests']);
 assert.equal(sections.flatMap(s => s.files).length, source.length);
 assert.equal(new Set(sections.map(s => s.id)).size, 3);
 assert.deepEqual(changeSections(source,'test').map(s => s.layer), ['Tests']);
 assert.deepEqual(changeSections(source,'no-such-file'), []);
});

test('compact folders stop at a file or a branch and retain every file', async () => {
 const {compactFileTree} = await import('../dist/core.mjs');
 const files = ['src/app/features/cart/ui/Button.tsx','src/app/features/cart/model/cart.ts','src/app/features/cart/index.ts','tests/unit/cart.test.ts'].map((path,i)=>({path,id:String(i)}));
 const tree = compactFileTree(files);
 assert.equal(tree[0].name,'src/app/features/cart');
 assert.deepEqual(tree[0].children.map(n=>n.name),['index.ts','model','ui']);
 assert.equal(tree[1].name,'tests/unit');
 const flatten = nodes => nodes.flatMap(n=>n.children?flatten(n.children):[n.file]);
 assert.deepEqual(flatten(tree).map(f=>f.path).sort(), files.map(f=>f.path).sort());
 assert.equal(compactFileTree([{path:'path/path/file.ts'}])[0].name,'path/path');
 assert.deepEqual(compactFileTree([]),[]);
});
