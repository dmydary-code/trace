import test from 'node:test';import assert from 'node:assert/strict';import {browserFallback} from '../lib/browser-fallback.mjs';
test('unacknowledged preview opens the exact URL; acknowledged preview cancels fallback',()=>{
 let fire,cleared=false;const opened=[];
 const cancel=browserFallback('http://127.0.0.1:1234',url=>opened.push(url),{schedule:cb=>{fire=cb;return 1;},cancel:()=>{cleared=true;}});
 cancel();assert.equal(cleared,true);
 browserFallback('http://127.0.0.1:5678',url=>opened.push(url),{schedule:cb=>{fire=cb;return 2;}});fire();
 assert.deepEqual(opened,['http://127.0.0.1:5678']);
});
