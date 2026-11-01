import test from 'node:test';
import assert from 'node:assert/strict';
import {classify,orderedFiles,parseDiff,reviewPrompt} from '../dist/core.mjs';
import {demos} from '../dist/demo.mjs';
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
