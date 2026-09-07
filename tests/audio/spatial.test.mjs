import test from 'node:test';
import assert from 'node:assert/strict';
import { panFor, audibleState, segmentDistance } from '../../src/audio/spatial.js';
test('directional cues follow camera orientation and preserve centered sounds',()=>{
 const origin={x:0,z:0};
 assert.equal(panFor({x:3,z:0},origin,0),1);
 assert.equal(panFor({x:-3,z:0},origin,0),-1);
 assert.equal(panFor({x:0,z:-3},origin,0),0);
 assert.ok(panFor({x:0,z:-3},origin,Math.PI/2)>.99);
 assert.equal(panFor(origin,origin,0),0);
});
test('death cue remains audible while menu and pause are silent',()=>{
 assert.equal(audibleState('dead'),true);assert.equal(audibleState('playing'),true);
 for(const state of ['ready','paused','complete'])assert.equal(audibleState(state),false);
});

test('near misses use bounded segments so cover-stopped shots do not whistle past',()=>{
 const listener={x:0,y:1.6,z:0};
 assert.equal(segmentDistance(listener,{x:-5,y:1.6,z:0},{x:5,y:1.6,z:0}),0);
 assert.equal(segmentDistance(listener,{x:-5,y:1.6,z:0},{x:-2,y:1.6,z:0}),2);
 assert.equal(segmentDistance(listener,{x:0,y:1.6,z:3},{x:0,y:1.6,z:3}),3);
});
