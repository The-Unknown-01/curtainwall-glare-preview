/** R02 demonstration geometry. ENU metres; all material values are assumptions. */
import { firstHit, reflect, tiltNormal } from './optics.js';

export const MODEL = Object.freeze({ revision: 'R02-demo-1', gap: 0.6, height: 3.15, pitch: 3.5, stepH: 12, stepV: 7, finR: 0.12, finT: 0.65 });
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

function samples(building, facade) {
  const z0=Math.max((building.minHeight||0)+3,6),z1=building.height-2;
  const out=[];
  // Fixed computational resolution, independent of viewport and device.
  for(const edge of facade.edges) {
    const cols=Math.max(1,Math.ceil(edge.len/MODEL.stepH));
    for(let i=0;i<cols;i++) {
      const u=(i+.5)/cols;
      for(let sill=z0;sill+MODEL.height<z1;sill+=MODEL.stepV) {
        out.push({x:edge.ax+(edge.bx-edge.ax)*u,y:edge.ay+(edge.by-edge.ay)*u,sill,h:MODEL.height*.5,area:edge.len/cols*MODEL.stepV});
      }
    }
  }
  return out;
}

function outside(p,tile) {
  const b=tile.meta.bounds;
  return b && (p[0]<b.minX || p[0]>b.maxX || p[1]<b.minY || p[1]>b.maxY);
}

function pathFrom(origin,dir,tile,building,weight,branch) {
  const hit=firstHit(origin,dir,tile,building.id,.05,1600);
  const kind=hit?.kind || (dir[2]>0 ? 'sky':'ground');
  const end=hit?.point || add(origin,dir,240);
  const path={origin,kind,energy:weight,branch,neighborId:hit?.building?.id||'',neighborName:hit?.building?.name||'',hops:[{from:origin.slice(),to:end.slice(),kind}],unassessed:!hit||outside(end,tile)};
  if(hit?.wall) {
    const normal=dot(hit.normal,dir)<0?hit.normal:hit.normal.map(v=>-v);
    const reflected=reflect(normal,dir.map(v=>-v)).r;
    const origin2=add(hit.point,normal,.1);
    const next=firstHit(origin2,reflected,tile,hit.building.id,.05,1600);
    const kind2=next?.kind||(reflected[2]>0?'sky':'ground');
    const to=next?.point||add(origin2,reflected,160);
    path.hops.push({from:hit.point.slice(),to:to.slice(),kind:kind2});
    path.unassessed ||= !next||outside(to,tile);
  }
  return path;
}

export function traceTwin(tile,{building,facade,alpha=0,sun,dni=800,rho=.3,scenario='adaptive'}) {
  const points=samples(building,facade),paths=[],occlusions=[];
  const counts={panels:points.length,backlit:0,shaded:0,lit:0,street:0,neighbor:0,water:0,sky:0,ground:0,roof:0,hop2:0,hop2sky:0,hop2water:0,hop2street:0,hop2ground:0,hop2roof:0,hop2neighbor:0};
  const hasFin=scenario!=='baseline';
  const nh=[...facade.n,0], normal=hasFin?tiltNormal(facade.n,alpha):nh;
  for(const p of points) {
    const base=[p.x+nh[0]*.02,p.y+nh[1]*.02,p.sill+p.h];
    const local=finPoint(p.x,p.y,p.h,facade.n,alpha);
    const origin=hasFin?[local[0],local[1],local[2]+p.sill]:base;
    const incidence=dot(normal,sun);
    if(incidence<=.02 || dni<=0) {counts.backlit++;continue;}
    const shadow=firstHit(origin,sun,tile,building.id,.1,5000);
    if(shadow) {counts.shaded++;if(occlusions.length<3)occlusions.push({from:origin,to:shadow.point,kind:shadow.kind});continue;}
    counts.lit++;
    const factor=Math.max(0,dni*incidence*p.area);
    const primary=pathFrom(origin,reflect(normal,sun).r,tile,building,factor*(hasFin?MODEL.finR:rho),hasFin?'fin':'original');
    primary.normal=normal;
    paths.push(primary);
    if(hasFin && dot(nh,sun)>.02) {
      // Parallel-plane approximation: sunlight transmitted to the fixed wall,
      // then reflected outward through the fin. No refractive displacement,
      // finite-edge clipping or further interreflection is modelled in this demo.
      const incoming=sun.map(v=>-v);
      const distance=dot(base.map((v,i)=>v-origin[i]),nh)/dot(incoming,nh);
      const wall=add(origin,incoming,Math.max(0,distance));
      const out=reflect(nh,sun).r;
      const exitDistance=dot(origin.map((v,i)=>v-wall[i]),normal)/dot(out,normal);
      const canExit=dot(out,normal)>.02 && exitDistance>=0;
      const secondary=pathFrom(canExit?add(wall,out,exitDistance+.02):wall,out,tile,building,factor*MODEL.finT*MODEL.finT*rho,'transmitted-original');
      secondary.normal=nh;
      secondary.unassessed ||= !canExit;
      paths.push(secondary);
    }
  }
  for(const path of paths) {
    counts[path.kind]++;
    if(path.hops.length>1) {counts.hop2++;const k='hop2'+path.hops[1].kind;if(k in counts)counts[k]++;}
  }
  return {paths,counts,panels:points.length,occlusions,model:MODEL.revision};
}

/** Geometric directional proxy, not photometric glare or legal compliance. */
export function summarize(result) {
  let total=0,sensitive=0,street=0,neighbor=0,unknown=0;
  for(const p of result.paths) {
    total+=p.energy;
    const road=p.hops.some(h=>h.kind==='street');
    const wall=p.hops.some(h=>h.kind==='neighbor');
    if(road||wall)sensitive+=p.energy;
    if(road)street+=p.energy;
    if(wall)neighbor+=p.energy;
    if(p.unassessed)unknown+=p.energy;
  }
  return {share:total?sensitive/total:null,street:total?street/total:null,neighbor:total?neighbor/total:null,unassessed:total?unknown/total:null,total,lit:result.counts.lit,samples:result.panels};
}

export function recommend(tile, options) {
  const candidates=[];
  for(let alpha=0;alpha<=50;alpha+=5) {
    const metrics=summarize(traceTwin(tile,{...options,alpha,scenario:'adaptive'}));
    if(metrics.share!==null)candidates.push({alpha,...metrics});
  }
  // A preview recommendation only; never reports a safe operating angle.
  candidates.sort((a,b)=>(a.share+a.unassessed*.15)-(b.share+b.unassessed*.15)||a.alpha-b.alpha);
  return candidates[0]||null;
}

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
