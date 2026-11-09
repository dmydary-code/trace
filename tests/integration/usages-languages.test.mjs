import test from '../support/test.mjs';
import assert from 'node:assert/strict';
import {projects} from '../support/projects.mjs';
import {diffTokens,findDiffUsages} from '../../dist/usages.mjs';
for(const project of projects)test('UI-05/06 '+project.id+' identifier spelling and old/new side contract',()=>{
 const lines=[{kind:'del',text:'return obsolete + shipping;',old:1,new:null},{kind:'add',text:'return amount + shipping;',old:null,new:1},{kind:'context',text:'label = "shipping is not code";',old:2,new:2}];
 assert.deepEqual(diffTokens(lines,'new',project.path).map(t=>t.name),['amount','shipping','label']);assert.deepEqual(diffTokens(lines,'old',project.path).map(t=>t.name),['obsolete','shipping','label']);
 const files=[{id:'source',path:project.path,lines},{id:'other',path:project.testPath,lines:[{kind:'add',text:'shippingTotal = shipping;',new:10}]}];
 assert.deepEqual(findDiffUsages(files,'shipping','new').map(r=>[r.id,r.line,r.side]),[['source',1,'new'],['other',10,'new']]);
});
