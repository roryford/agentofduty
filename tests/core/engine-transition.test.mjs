import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../../src/core/engine.js';
import { GameSession } from '../../src/core/session.js';
import { createEvents } from '../../src/core/events.js';
import { createInput } from '../../src/core/input.js';
import { createTime } from '../../src/core/time.js';
test('completion inside a fixed tick prevents later systems, catch-up ticks and visual simulation dt',()=>{
 const events=createEvents(),input=createInput();
 const session=new GameSession({events,input,lockstep:true});
 const engine=Object.create(Engine.prototype);
 engine.ctx={session,input,time:createTime(120)};
 engine._render=()=>{};engine.gpuTimer={begin(){},end(){}};
 let ticks=0,lateTicks=0,updateDt=-1,uiDt=-1;
 engine._ordered=[
  {constructor:{id:'mission'},fixedUpdate(){ticks++;session.complete();},update(dt){updateDt=dt;}},
  {constructor:{id:'ai'},fixedUpdate(){lateTicks++;}},
  {constructor:{id:'ui'},update(dt){uiDt=dt;}},
 ];
 engine._stepFrame(1/60,true);
 assert.equal(ticks,1);assert.equal(lateTicks,0);assert.equal(updateDt,0);assert.equal(uiDt,1/60);
 assert.equal(engine.ctx.time.accumulator,0);
});
