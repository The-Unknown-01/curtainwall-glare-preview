import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {finPoint,linkage,MODEL,traceTwin,summarize,recommend,validateRecords,exampleRecords} from './js/twin.js';
import {prepareTile,rankSubjects} from './js/optics.js';
import {sunVector,solarPosition,localToUtc,previewDni} from './js/solar.js';
import {parseCsv} from './js/dashboard.js';

// The hinge is stationary; the bottom moves out and up, with unchanged length.
const top=finPoint(0,0,MODEL.height,[0,-1],0);
for(const angle of [0,16,30,50]) {
  assert.deepEqual(finPoint(0,0,MODEL.height,[0,-1],angle),top);
  const bottom=finPoint(0,0,0,[0,-1],angle);
  assert.ok(Math.abs(Math.hypot(...bottom.map((v,i)=>v-top[i]))-MODEL.height)<1e-10);
  if(angle>0){assert.ok(bottom[1]<top[1]);assert.ok(bottom[2]>0);}
}
assert.ok(Math.abs(linkage(30).travel-86.1)<.1);
assert.ok(Math.abs(linkage(60).travel-278.8)<.1);
assert.equal(linkage(90),null);

assert.equal(recommend(),null,'angle scoring must remain disabled');

const sample=validateRecords(exampleRecords());assert.equal(sample.length,41);
assert.throws(()=>validateRecords([{timestamp:'2026-10-25T15:00:00',angle_deg:1},sample[1]]),/时区/);
assert.throws(()=>validateRecords([sample[0],sample[0]]),/递增/);
assert.throws(()=>validateRecords([sample[0],{...sample[1],angle_deg:99}]),/0–50/);
assert.throws(()=>validateRecords([sample[0],{...sample[1],target_deg:'bad'}]),/target_deg/);
assert.throws(()=>validateRecords([sample[0],null]));
const csv=parseCsv('\uFEFFtimestamp,angle_deg,target_deg\r\n"2026-10-25T15:00:00+08:00",0,0\r\n"2026-10-25T15:00:01+08:00",1,2\r\n');
assert.equal(validateRecords(csv)[1].angle_deg,1);
assert.throws(()=>parseCsv('timestamp,angle_deg\n"oops,1'),/引号/);
console.log('twin ok — top hinge, linkage, disabled ranking, record validation');
