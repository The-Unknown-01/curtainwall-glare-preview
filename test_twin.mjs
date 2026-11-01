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

const tile=prepareTile(JSON.parse(readFileSync(new URL('./data/central.json',import.meta.url))));
const preset=JSON.parse(readFileSync(new URL('./data/preset.json',import.meta.url)));
const subject=rankSubjects(tile,10).find(r=>r.building.id===preset.buildingId);
const pos=solarPosition(localToUtc(2026,12,21,15,0,'Asia/Hong_Kong'),22.284,114.16);
const opts={building:subject.building,facade:subject.cluster,alpha:16,sun:sunVector(pos.elevationDeg,pos.azimuthDeg),dni:previewDni(pos.elevationDeg),rho:.3};
const result=traceTwin(tile,opts);
assert.ok(result.paths.length>0);
assert.ok(result.paths.some(p=>p.branch==='transmitted-original' && p.energy>0),'fixed original wall reflection must remain');
assert.ok(result.paths.some(p=>p.branch==='fin'));
assert.ok(result.paths.every(p=>Number.isFinite(p.energy)&&p.energy>=0));
const desktop=traceTwin(tile,{...opts,stepH:12,stepV:15});
const phone=traceTwin(tile,{...opts,stepH:14,stepV:18});
assert.deepEqual(desktop,phone,'viewport parameters cannot change computational sampling');
const base=traceTwin(tile,{...opts,scenario:'baseline',alpha:0});
assert.ok(base.paths.every(p=>p.branch==='original'));
assert.equal(base.panels,result.panels,'same sampling population in before/after comparison');
const summary=summarize(result);
assert.ok(summary.share>=0&&summary.share<=1);
assert.ok(summary.unassessed>0,'unknown paths stay explicitly unassessed');
assert.equal(summarize(traceTwin(tile,{...opts,dni:0})).share,null);
const choice=recommend(tile,opts);assert.ok(choice&&choice.alpha>=0&&choice.alpha<=50);
assert.equal(recommend(tile,{...opts,dni:0}),null);

const sample=validateRecords(exampleRecords());assert.equal(sample.length,41);
assert.throws(()=>validateRecords([{timestamp:'2026-10-25T15:00:00',angle_deg:1},sample[1]]),/时区/);
assert.throws(()=>validateRecords([sample[0],sample[0]]),/递增/);
assert.throws(()=>validateRecords([sample[0],{...sample[1],angle_deg:99}]),/0–50/);
assert.throws(()=>validateRecords([sample[0],{...sample[1],target_deg:'bad'}]),/target_deg/);
assert.throws(()=>validateRecords([sample[0],null]));
const csv=parseCsv('\uFEFFtimestamp,angle_deg,target_deg\r\n"2026-10-25T15:00:00+08:00",0,0\r\n"2026-10-25T15:00:01+08:00",1,2\r\n');
assert.equal(validateRecords(csv)[1].angle_deg,1);
assert.throws(()=>parseCsv('timestamp,angle_deg\n"oops,1'),/引号/);
console.log('twin ok — top hinge, transmitted original branch, viewport invariance, comparison, search, record validation');
