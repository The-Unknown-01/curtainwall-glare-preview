/** R02 demonstration geometry. ENU metres; all material values are assumptions. */
import {OPTICS} from './finite-optics.js';

export const MODEL = OPTICS;
const dot = (a,b) => a.reduce((s,v,i)=>s+v*b[i],0);
const add = (a,b,t) => a.map((v,i)=>v+b[i]*t);

/** Height from sill; top stays fixed as the lower edge moves out. */
export function finPoint(x,y,localH,nh,angle,height=MODEL.height) {
  const a=angle*Math.PI/180, depth=height-localH;
  return [x+(MODEL.gap+depth*Math.sin(a))*nh[0], y+(MODEL.gap+depth*Math.sin(a))*nh[1], height-depth*Math.cos(a)];
}

export function linkage(angle, {a=240,e=60,l=300}={}) {
  const t=angle*Math.PI/180,q=e+a*Math.sin(t);
  if(q>=l || angle<0 || angle>60) return null;
  const s=a*Math.cos(t)+Math.sqrt(l*l-q*q);
  const parked=a+Math.sqrt(l*l-e*e);
  return {s, travel:parked-s, angle};
}

export {traceCity as traceTwin, finiteSummary as summarize} from './finite-optics.js';
// Recommendation stays disabled until receptor metrics and material data are validated.
export function recommend(){return null;}

export function validateRecords(input) {
  if(!Array.isArray(input)||input.length<2||input.length>2000)throw new Error('需要 2–2000 条记录');
  let prev=-Infinity;
  return input.map((r,i)=>{
    if(!r || typeof r.timestamp!=='string' || !/(Z|[+-]\d{2}:\d{2})$/i.test(r.timestamp))throw new Error(`第 ${i+1} 条 timestamp 须含Z或时区偏移`);
    const t=Date.parse(r.timestamp),angle=Number(r.angle_deg);
    if(!Number.isFinite(t)||t<=prev)throw new Error(`第 ${i+1} 条时间须有效且严格递增`);
    if(r.angle_deg==null||r.angle_deg===''||!Number.isFinite(angle)||angle<0||angle>50)throw new Error(`第 ${i+1} 条 angle_deg 须在 0–50°`);
    prev=t;
    const target=r.target_deg==null||r.target_deg===''?null:Number(r.target_deg);
    if(target!==null&&(!Number.isFinite(target)||target<0||target>50))throw new Error(`第 ${i+1} 条 target_deg 无效`);
    return {timestamp:new Date(t).toISOString(),angle_deg:angle,target_deg:target};
  });
}

export function exampleRecords() {
  const start=Date.UTC(2026,9,25,7);
  return Array.from({length:41},(_,i)=>{
    const target=i<5?0:i<22?30:16;
    const angle=i<5?0:i<15?(i-4)*3:i<22?30:i<29?30-(i-21)*2:16;
    return {timestamp:new Date(start+i*1000).toISOString(),angle_deg:angle,target_deg:target};
  });
}
