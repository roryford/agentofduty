import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
for (const [tool,args,message] of [
 ['capture',['--w','0'],'Invalid w'],
 ['capture',['--seed','NaN'],'Invalid seed'],
 ['capture',['--unknown','1'],'Unknown argument'],
 ['play',['--seconds','-1'],'Invalid soak seconds'],
 ['play',['--seconds'],'Invalid soak seconds'],
 ['play',['--seconds','NaN'],'Invalid soak seconds'],
 ['play',['--unknown','600'],'Unknown play arguments'],
 ['play',['--seconds','600','--typo'],'Unknown play arguments'],
]) test(`demonstrated red: ${tool} rejects ${args.join(' ')}`,()=>{
 const result=spawnSync(process.execPath,[new URL(`../../tools/${tool}.mjs`,import.meta.url).pathname,...args],{encoding:'utf8',timeout:10000});
 assert.ifError(result.error);assert.notEqual(result.status,0);assert.match(result.stderr,new RegExp(message));
});
