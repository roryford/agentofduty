#!/usr/bin/env node
/** Automated mission route using only DOM input. Reads scene state for navigation/aiming; never applies damage or moves actors directly. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { serve } from './lib/server.mjs';
const server=await serve(new URL('../dist/',import.meta.url).pathname);
let browser;
try {
 browser=await chromium.launch({headless:true,channel:'chrome',args:['--use-gl=angle',...(process.platform==='darwin'?['--use-angle=metal']:[])]});
 const page=await browser.newPage({viewport:{width:1280,height:720}});const errors=[];
 page.on('pageerror',error=>errors.push(String(error)));
 await page.goto(server.url+'/?seed=7');await page.waitForFunction(()=>window.__READY__);
 await page.mouse.move(320,460);await page.getByRole('button',{name:'DEPLOY'}).click();
 await page.waitForFunction(()=>window.__ENGINE__.ctx.session.playing);
 const start=Date.now(), samples=[];let mouseX=320,mouseY=460,previousStage=-1;
 await mkdir(new URL('../captures/',import.meta.url),{recursive:true});
 while(Date.now()-start<240000){
  const state=await page.evaluate(()=>{
   const c=window.__ENGINE__.ctx,p=c.get('player'),ai=c.get('ai'),mission=c.get('mission'),world=c.get('world'),physics=c.get('physics');
   const eye=p.getEyePosition();
   const targets=ai.enemies.filter(e=>e.alive).map(e=>{
    const dx=e.position.x-eye.x,dy=1.22-eye.y,dz=e.position.z-eye.z,range=Math.hypot(dx,dy,dz);
    const block=physics.raycast(eye.x,eye.y,eye.z,dx,dy,dz,range,1);
    return{x:e.position.x,y:1.22,z:e.position.z,range,visible:!block};
   }).sort((a,b)=>Number(b.visible)-Number(a.visible)||a.range-b.range);
   const target=targets[0]||{...mission.current.exit,y:eye.y};
   let waypoint={x:target.x,z:target.z};
   if(!target.visible){
    const path=new Int32Array(1024),length=world.findPath(p.position.x,p.position.z,target.x,target.z,path);
    if(length>1){const cell=path[1];waypoint=world.cellToWorld(cell%world.nav.sizeX,Math.floor(cell/world.nav.sizeX),{});}
   }
   return{state:c.session.state,index:mission.index,yaw:p.yaw,pitch:p.pitch,position:p.position.toArray(),eye:{x:eye.x,y:eye.y,z:eye.z},target,waypoint,
    ammo:c.get('weapons').current.ammo,reloading:c.get('weapons')._reloading,ads:p.ads,sensitivity:c.session.settings.sensitivity,adsSensitivity:c.session.settings.adsSensitivity,
    health:p.health,alive:targets.length,retries:c.session.retries,kills:mission.kills};
  });
  if(state.state==='complete'){
   await page.screenshot({path:new URL('../captures/route-victory.png',import.meta.url).pathname});
   assert.deepEqual(errors,[]);
   const report={input:'DOM keyboard/mouse only; scene state read for automated aiming/navigation',elapsedSeconds:(Date.now()-start)/1000,retries:state.retries,kills:state.kills,checkpoints:samples};
   await writeFile(new URL('../captures/route-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
   console.log('ROUTE PASS',JSON.stringify(report));break;
  }
  if(state.index!==previousStage){samples.push({stage:state.index,time:(Date.now()-start)/1000,health:state.health});console.log(`[route] stage ${state.index+1}, health ${state.health}`);previousStage=state.index;}
  if(state.state==='dead'){await page.mouse.up();await page.keyboard.up('KeyW');await page.keyboard.up('KeyE');await page.waitForTimeout(250);continue;}
  if(state.state==='paused'){await page.getByRole('button',{name:'RESUME'}).click();continue;}
  if(state.ammo<4&&!state.reloading){await page.mouse.up();await page.keyboard.press('KeyR',{delay:60});}
  const shooting=state.target.visible&&!state.reloading&&state.ammo>0;
  const goal=shooting?state.target:{...state.waypoint,y:state.eye.y};
  const dx=goal.x-state.eye.x,dz=goal.z-state.eye.z,dy=goal.y-state.eye.y;
  const desiredYaw=Math.atan2(-dx,-dz),desiredPitch=shooting?Math.atan2(dy,Math.hypot(dx,dz)):0;
  const yawDelta=Math.atan2(Math.sin(desiredYaw-state.yaw),Math.cos(desiredYaw-state.yaw));
  const sensitivity=state.sensitivity*(state.ads?state.adsSensitivity:1);
  mouseX-=yawDelta/sensitivity;mouseY-=(desiredPitch-state.pitch)/sensitivity;
  await page.mouse.move(mouseX,mouseY);
  if(shooting){await page.keyboard.up('KeyW');await page.keyboard.down('KeyE');await page.mouse.down();}
  else {await page.mouse.up();await page.keyboard.up('KeyE');if(Math.hypot(dx,dz)>.5)await page.keyboard.down('KeyW');else await page.keyboard.up('KeyW');}
  await page.waitForTimeout(110);
 }
 assert.equal(await page.evaluate(()=>window.__ENGINE__.ctx.session.state),'complete','Automated real-input route must reach extraction within four minutes');
}finally{await browser?.close();await server.close();}
