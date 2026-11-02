import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutGraph} from '../dist/graph-layout.mjs';
test('tree layout keeps diamonds, cycles and isolated nodes without node overlap',()=>{
 const nodes=['a','b','c','d','isolated'].map(path=>({path}));
 const edges=[['a','b'],['a','c'],['b','d'],['c','d'],['d','a']].map(([source,target])=>({source,target}));
 const layout=layoutGraph(nodes,edges);
 assert.equal(layout.positions.size,5);
 assert.equal(new Set([...layout.positions.values()].map(p=>p.y)).size,5);
 assert.equal(layout.branches.size,3);
 for(const key of layout.branches){const [a,b]=JSON.parse(key);assert(layout.positions.get(b).x>layout.positions.get(a).x);}
 assert.deepEqual(layout,layoutGraph(nodes,edges));
});

import {stableGraphLayout} from '../dist/graph-layout.mjs';
test('selection and filtering never change snapshot positions or canvas bounds',()=>{
 const nodes=[{path:'a',changed:true},{path:'b',changed:true},{path:'context',changed:false},{path:'other',changed:false}];
 const edges=[{source:'context',target:'a'},{source:'a',target:'b'}];
 const fixed=stableGraphLayout(nodes,edges);
 assert.deepEqual(fixed.positions.get('a'),layoutGraph(nodes.filter(n=>n.changed),edges).positions.get('a'));
 assert.deepEqual(fixed,stableGraphLayout(nodes,edges));
 const points=[...fixed.positions.values()];assert.equal(new Set(points.map(p=>p.y)).size,points.length);
});

import {revealGraphPath, fileCommentCount} from '../dist/graph-layout.mjs';
test('context expansion retains the selected context and its previous neighbors',()=>{
 const edges=[{source:'changed',target:'context'},{source:'context',target:'next'}];
 const first=revealGraphPath(new Set(),'changed',edges);
 const second=revealGraphPath(first,'context',edges);
 assert.deepEqual([...first],['changed','context']);
 assert.deepEqual([...second],['changed','context','next']);
 assert.equal(fileCommentCount([{path:'changed'},{path:'changed',resolved:true},{path:'next'}],'changed'),2);
 assert.equal(fileCommentCount([],'changed'),0);
});

import {routeGraphEdges} from '../dist/graph-layout.mjs';
test('parallel dependency kinds and shared parents use separate lanes and ports',()=>{
 const positions=new Map([['a',{x:150,y:65}],['b',{x:490,y:165}],['c',{x:490,y:265}]]);
 const edges=[{source:'a',target:'b',kind:'Imports'},{source:'a',target:'b',kind:'Calls'},{source:'a',target:'c',kind:'Imports'}];
 const routes=[...routeGraphEdges(edges,positions).values()];
 assert.equal(new Set(routes.map(r=>r.lane)).size,3);
 assert.equal(new Set(routes.map(r=>r.sy)).size,3);
 assert.notEqual(routes[0].path,routes[1].path);
});

import {graphZoom} from '../dist/graph-layout.mjs';
test('graph zoom respects limits for button steps and pinch gestures',()=>{
 assert.equal(graphZoom(1*1.2),1.2);
 assert.equal(graphZoom(.1),.25);
 assert.equal(graphZoom(5),3);
 assert.equal(graphZoom(1.2/1.2),1);
});
