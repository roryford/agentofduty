#!/usr/bin/env node
/** Seeded, explicitly staged visual coverage. Use play.mjs for real-input evidence. */
import { readFile, mkdir, mkdtemp, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serve } from './lib/server.mjs';
import { currentBuild, revision, sha256 } from './lib/evidence.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = { out: path.join(ROOT, 'captures'), seed: 1, w: 1280, h: 720, port: 0 };
for (let i=2;i<process.argv.length;i++) {
  const key = process.argv[i].slice(2);
  if (!Object.hasOwn(args,key)) throw new Error(`Unknown argument ${process.argv[i]}`);
  const value = process.argv[++i];
  args[key] = key === 'out' ? path.resolve(value) : Number(value);
  if (key !== 'out' && (!Number.isInteger(args[key]) || args[key] < (key === 'port' || key === 'seed' ? 0 : 1))) throw new Error(`Invalid ${key}`);
}
await mkdir(args.out,{recursive:true});
// Invalidate the prior result before any operation that can fail.
await writeFile(path.join(args.out,'manifest.json'), JSON.stringify({schemaVersion:1,status:'incomplete'})+'\n');
const build = await currentBuild();
const shots = JSON.parse(await readFile(path.join(ROOT,'tools/shots.json'),'utf8'));
if (!Array.isArray(shots) || !shots.length || new Set(shots.map(s=>s.name)).size !== shots.length) throw new Error('Invalid or duplicate capture manifest');
await mkdir(path.join(args.out,'runs'),{recursive:true});
const runDir = await mkdtemp(path.join(args.out,'runs/run-'));
const runId = path.basename(runDir);
const server = await serve(path.join(ROOT,'dist'),args.port);
let browser;
try {
  browser = await chromium.launch({headless:true,channel:'chrome',args:['--use-gl=angle',...(process.platform==='darwin'?['--use-angle=metal']:[]),'--hide-scrollbars']});
  const manifest={schemaVersion:1,status:'complete',runId,capturedAt:new Date().toISOString(),provenance:{...build,...revision(),browser:browser.version(),platform:process.platform,renderer:null},seed:args.seed,width:args.w,height:args.h,staged:true,shots:[]};
  for (const shot of shots) {
    if (!/^[a-z0-9-]+$/.test(shot.name) || !Number.isInteger(shot.frame) || shot.frame < 0) throw new Error('Invalid shot');
    const page=await browser.newPage({viewport:{width:args.w,height:args.h},deviceScaleFactor:1});
    const errors=[];
    page.on('pageerror',e=>errors.push(String(e)));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto(`${server.url}/?lockstep=1&seed=${args.seed}&w=${args.w}&h=${args.h}`,{waitUntil:'networkidle'});
    await page.waitForFunction(()=>window.__BOOT_COMPLETE__&&window.__READY__);
    await page.evaluate(shot=>{
      const c=window.__ENGINE__.ctx,p=c.get('player'),w=c.get('weapons'),mission=c.get('mission');
      if (shot.encounter !== undefined) {
        if (!mission.encounters[shot.encounter]) throw new Error('Missing declared encounter');
        mission.index=shot.encounter;c.session.retry();
      }
      if (shot.mode === 'practice') {
        c.session.setState('ready'); mission.configure('practice',shot.encounter ?? 0);
        if (shot.pose !== 'ready') c.session.start();
      }
      if (shot.yaw !== undefined)p.yaw=shot.yaw;
      if (shot.pitch !== undefined)p.pitch=shot.pitch;
      if (shot.pose==='ads')c.input.keys.KeyE=true;
      if (shot.pose==='fire')c.input.buttons[0]=true;
      if (shot.pose==='reload'){c.input.buttons[0]=true;window.__PUMP__(7);c.input.buttons[0]=false;c.input.keys.KeyR=true;}
      if (shot.pose==='damage')c.events.emit('damage:dealt',{target:'player',from:'enemy-0',amount:35,headshot:false,point:{x:p.eye.x,y:p.eye.y,z:p.eye.z}});
      if (shot.pose==='death')c.events.emit('damage:dealt',{target:'player',from:'enemy-0',amount:1000,headshot:false,point:{x:p.eye.x,y:p.eye.y,z:p.eye.z}});
      if (shot.pose==='ready')c.session.setState('ready');
      if (shot.pose==='pause')c.session.pause();
      if (shot.pose==='victory')c.session.complete();
      window.__PUMP__(shot.frame);
      // Render once even for a frozen menu/zero-frame shot.
      window.__PUMP__(1);
    },shot);
    if (shot.pose==='pause') { await page.locator('summary').click(); await page.evaluate(()=>window.__PUMP__(1)); }
    const buffer=shot.ui?await page.screenshot():Buffer.from((await page.evaluate(()=>document.getElementById('game').toDataURL('image/png'))).split(',')[1],'base64');
    await writeFile(path.join(runDir,shot.name+'.png'),buffer);
    const metrics=await page.evaluate(()=>window.__METRICS__());
    if(errors.length)throw new Error(`${shot.name}: ${errors.join('\n')}`);
    if(metrics.shaderCompilesAfterReady!==0)throw new Error(`${shot.name}: shader compile after ready`);
    if (!metrics.renderer) throw new Error('Missing renderer identity');
    manifest.provenance.renderer ??= metrics.renderer;
    manifest.shots.push({...shot,file:`runs/${runId}/${shot.name}.png`,sha256:sha256(buffer),bytes:buffer.length,drawCalls:metrics.drawCalls,shaderCompilesAfterReady:metrics.shaderCompilesAfterReady});
    console.log(`[capture] ${shot.name}: ${metrics.drawCalls} draws`);
    await page.close();
  }
  const latest = await currentBuild();
  if (latest.sourceDigest !== build.sourceDigest || latest.buildDigest !== build.buildDigest) throw new Error('Build changed during capture');
  await writeFile(path.join(runDir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  await writeFile(path.join(runDir,'index.html'),`<!doctype html><meta charset="utf-8"><title>Nightfall capture review</title><style>body{background:#111;color:#eee;font:16px system-ui;margin:24px}main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}figure{margin:0}img{width:100%}figcaption{padding:8px}</style><h1>Nightfall — ${manifest.capturedAt}</h1><p>Staged visual evidence · revision ${manifest.provenance.revision} · dirty: ${manifest.provenance.dirty}</p><main>${shots.map(s=>`<figure><a href="${s.name}.png"><img src="${s.name}.png"></a><figcaption>${s.name}${s.ui?' · includes HUD':''}</figcaption></figure>`).join('')}</main>`);
  await writeFile(path.join(runDir,'latest.json'),JSON.stringify(manifest,null,2)+'\n');
  await rename(path.join(runDir,'latest.json'),path.join(args.out,'manifest.json'));
  console.log(`[capture] wrote ${shots.length} staged views`);
} finally { await browser?.close();await server.close(); }
