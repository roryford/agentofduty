import test from 'node:test';
import assert from 'node:assert/strict';
import { MissionSystem } from '../../src/mission/MissionSystem.js';
import { GameSession } from '../../src/core/session.js';
import { createEvents } from '../../src/core/events.js';
import { createInput } from '../../src/core/input.js';
async function fixture() {
 const events=createEvents(),input=createInput();
 const enemies=[{alive:true,position:{x:0,z:10}}];
 const stages=[0,1,2].map(i=>({name:`Stage ${i}`,objective:'Clear defenders',spawn:{x:0,y:0,z:40-i*30,yaw:0},enemySpawns:[{x:0,z:10-i*30}],exit:{x:0,z:10-i*30,radius:3}}));
 const player={position:{x:0,z:10}};
 const systems={world:{encounters:stages},ai:{enemies},player};
 const ctx={events,input,get:id=>systems[id]};
 ctx.session=new GameSession({events,input,lockstep:true});
 const mission=new MissionSystem(); await mission.init(ctx);
 events.on('session:reset',p=>{enemies[0].alive=p.enemySpawns.length > 0;player.position.x=p.spawn.x;player.position.z=p.spawn.z;});
 return {ctx,mission,enemies,player};
}
test('checkpoint needs both area clear and player at rally, then resets next encounter',async()=>{
 const {ctx,mission,enemies,player}=await fixture();
 mission.fixedUpdate(1,ctx);assert.equal(mission.index,0);
 enemies[0].alive=false;player.position.z=40;mission.fixedUpdate(1,ctx);assert.equal(mission.index,0);
 player.position.z=10;mission.fixedUpdate(1,ctx);assert.equal(mission.index,1);assert.equal(enemies[0].alive,true);assert.equal(ctx.session.retries,0);
});
test('final extraction requires uninterrupted hold and full restart resets stage',async()=>{
 const {ctx,mission,enemies,player}=await fixture();mission.index=2;enemies[0].alive=false;player.position.z=-50;
 mission.fixedUpdate(7,ctx);assert.equal(ctx.session.state,'playing');
 player.position.z=0;mission.fixedUpdate(1,ctx);assert.equal(mission.hold,0);
 player.position.z=-50;mission.fixedUpdate(8,ctx);assert.equal(ctx.session.state,'complete');
 ctx.session.retry(true);assert.equal(mission.index,0);assert.equal(mission.hold,0);assert.equal(enemies[0].alive,true);
});
test('paused missions do not advance and resolved events count only player hits',async()=>{
 const {ctx,mission,enemies}=await fixture();enemies[0].alive=false;ctx.session.pause();mission.fixedUpdate(5,ctx);assert.equal(mission.index,0);
 ctx.events.emit('weapon:fire',{from:'player'});ctx.events.emit('weapon:fire',{from:'enemy-0'});
 ctx.events.emit('combat:hit',{from:'player',target:'enemy-0'});ctx.events.emit('combat:hit',{from:'enemy-0',target:'player'});
 assert.equal(mission.shots,1);assert.equal(mission.hits,1);
});

test('practice removes hostiles and suppresses progression even at extraction',async()=>{
 const {ctx,mission,enemies,player}=await fixture();ctx.session.setState('ready');
 mission.configure('practice',2);
 assert.equal(ctx.session.state,'ready');assert.equal(mission.index,2);assert.equal(enemies[0].alive,false);
 assert.deepEqual(mission.restore().enemySpawns,[]);assert.equal(mission.restore().practice,true);
 ctx.session.start();player.position.z=-50;
 for(let i=0;i<1200;i++)mission.fixedUpdate(1/120,ctx);
 assert.equal(ctx.session.state,'playing');assert.equal(mission.hold,0);assert.equal(mission.index,2);
});
test('practice resets preserve selected area and switching back restores mission',async()=>{
 const {ctx,mission,enemies,player}=await fixture();ctx.session.setState('ready');mission.configure('practice',1);
 ctx.session.retry(true);assert.equal(mission.index,1);assert.equal(enemies[0].alive,false);
 player.position.z=999;const retries=ctx.session.retries;mission.resetPosition();
 assert.equal(player.position.z,mission.current.spawn.z);assert.equal(ctx.session.retries,retries);
 ctx.session.pause();mission.configure('mission');
 assert.equal(mission.index,0);assert.equal(enemies[0].alive,true);assert.equal(ctx.session.mode,'mission');
});
test('mode changes reject invalid or active-play requests without changing the session',async()=>{
 const {ctx,mission}=await fixture();
 assert.throws(()=>mission.configure('practice',0),/Pause/);assert.equal(ctx.session.mode,'mission');
 ctx.session.pause();assert.throws(()=>mission.configure('invalid'),/mode/);
 assert.throws(()=>mission.configure('practice',99),/encounter/);assert.equal(ctx.session.mode,'mission');
});
