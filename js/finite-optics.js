/** Finite, zero-thickness optical sheets. Constant effective R/T/A, not glare photometry. */
import { firstHit } from './optics.js';

export const OPTICS = Object.freeze({revision:'finite-sheets-2',gap:.6,height:3.15,pitch:3.5,width:3,finR:.12,finT:.65,oldT:.6,columns:8,rows:18,maxDepth:8,minFraction:1e-5});
export const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
export const add=(a,b,k=1)=>a.map((x,i)=>x+k*b[i]);
export const norm=a=>{const l=Math.hypot(...a);return a.map(x=>x/l);};
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const reflected=(d,n)=>add(d,n,-2*dot(d,n));
const EPS=1e-5;

export function rectangle(id,origin,u,v,normal,material,role='fin') {
  if(!Number.isFinite(material.R)||!Number.isFinite(material.T)||material.R<0||material.T<0||material.R+material.T>1+1e-12)throw new Error('Invalid R/T/A material');
  if(dot(u,u)<1e-12||dot(v,v)<1e-12||Math.abs(dot(u,v))>1e-8*Math.sqrt(dot(u,u)*dot(v,v)))throw new Error('Degenerate or non-orthogonal rectangle');
  return {id,origin,u,v,normal:norm(normal),material:{...material,A:Math.max(0,1-material.R-material.T)},role,corners:[origin,add(origin,u),add(add(origin,u),v),add(origin,v)]};
}

export function intersectRectangle(origin,direction,surface,tMax=Infinity) {
  const denominator=dot(direction,surface.normal);
  if(Math.abs(denominator)<1e-10)return null;
  const distance=dot(add(surface.origin,origin,-1),surface.normal)/denominator;
  if(distance<EPS||distance>=tMax)return null;
  const point=add(origin,direction,distance),q=add(point,surface.origin,-1);
  const u=dot(q,surface.u)/dot(surface.u,surface.u),v=dot(q,surface.v)/dot(surface.v,surface.v);
  if(u< -1e-9||u>1+1e-9||v< -1e-9||v>1+1e-9)return null;
  return {distance,point,surface,u,v};
}

export function buildAssembly(building,facade,alpha,scenario='adaptive',rho=.3) {
  const surfaces=[],envelope=[];
  const z0=Math.max((building.minHeight||0)+3,6),z1=building.height-1.2;
  const t=alpha*Math.PI/180;
  for(let e=0;e<facade.edges.length;e++) {
    const edge=facade.edges[e],n=[edge.nx,edge.ny,0],u=[edge.bx-edge.ax,edge.by-edge.ay,0];
    surfaces.push(rectangle(`wall-${e}`,[edge.ax+n[0]*.03,edge.ay+n[1]*.03,z0],u,[0,0,z1-z0],n,{R:rho,T:OPTICS.oldT},'original'));
    // A fixed envelope for every scenario; light-plane samples never change with angle.
    for(const x of [edge.ax,edge.bx])for(const y of [edge.ay,edge.by])for(const z of [z0,z1])for(const out of [0,OPTICS.gap+OPTICS.height])envelope.push([x+n[0]*out,y+n[1]*out,z]);
    if(scenario==='baseline')continue;
    const count=Math.ceil(edge.len/OPTICS.width),width=edge.len/count;
    const tangent=[u[0]/edge.len,u[1]/edge.len,0];
    for(let c=0;c<count;c++)for(let sill=z0;sill+OPTICS.height<z1;sill+=OPTICS.pitch) {
      const origin=[edge.ax+tangent[0]*c*width+n[0]*OPTICS.gap,edge.ay+tangent[1]*c*width+n[1]*OPTICS.gap,sill+OPTICS.height];
      surfaces.push(rectangle(`fin-${e}-${c}-${Math.round((sill-z0)/OPTICS.pitch)}`,origin,tangent.map(x=>x*width),[n[0]*OPTICS.height*Math.sin(t),n[1]*OPTICS.height*Math.sin(t),-OPTICS.height*Math.cos(t)],[n[0]*Math.cos(t),n[1]*Math.cos(t),Math.sin(t)],{R:OPTICS.finR,T:OPTICS.finT},'fin'));
    }
  }
  return {surfaces,envelope};
}

export function makeSource(envelope,sun,columns=OPTICS.columns,rows=OPTICS.rows) {
  const s=norm(sun),u=norm(Math.hypot(s[0],s[1])<1e-8?[1,0,0]:[-s[1],s[0],0]),v=norm(cross(s,u));
  const project=axis=>envelope.map(p=>dot(p,axis));
  const us=project(u),vs=project(v),ss=project(s);
  const loU=Math.min(...us)-.1,hiU=Math.max(...us)+.1,loV=Math.min(...vs)-.1,hiV=Math.max(...vs)+.1;
  const front=Math.max(...ss)+1200,roots=[];
  for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){
    const origin=add(add(s.map(k=>k*front),u,loU+(x+.5)*(hiU-loU)/columns),v,loV+(y+.5)*(hiV-loV)/rows);
    roots.push({id:`P${String(y*columns+x+1).padStart(3,'0')}`,origin,direction:s.map(k=>-k),power:1/(columns*rows)});
  }
  return {roots,apertureArea:(hiU-loU)*(hiV-loV),columns,rows,u,v};
}

/** Explicit graph: every spawned ray has one parent; every split closes its energy account. */
export function traceFinite({surfaces,roots,environment=null,maxDepth=OPTICS.maxDepth,minFraction=OPTICS.minFraction}) {
  const nodes=[],segments=[],terminals=[];
  const ledger={launched:0,absorbed:0,interior:0,receiver:0,occluded:0,unassessed:0,truncated:0};
  let serial=0;
  const terminate=(ray,category,point,kind,extra={})=>{
    ledger[category]+=ray.power;
    const terminal={id:`T${++serial}`,parentId:ray.parentId,rootId:ray.rootId,category,kind,point,power:ray.power,type:ray.type,touched:ray.touched,...extra};
    terminals.push(terminal);
    return terminal;
  };
  for(const root of roots){
    ledger.launched+=root.power;
    const queue=[{...root,rootId:root.id,parentId:null,from:root.origin,depth:0,type:'incident',touched:false}];
    while(queue.length){
      const ray=queue.pop();
      if(ray.depth>=maxDepth||ray.power<root.power*minFraction){terminate(ray,'truncated',ray.from,'cutoff');continue;}
      let closest=null;
      for(const surface of surfaces){const hit=intersectRectangle(ray.origin,ray.direction,surface,closest?.distance);if(hit)closest=hit;}
      const env=environment?.(ray.origin,ray.direction,closest?.distance??5000);
      if(env&&(!closest||env.distance<closest.distance)){
        segments.push({id:`S${++serial}`,rootId:ray.rootId,parentId:ray.parentId,from:ray.from,to:env.point,type:ray.type,power:ray.power});
        terminate(ray,ray.touched?(env.unassessed?'unassessed':'receiver'):'occluded',env.point,env.kind,{name:env.name||''});continue;
      }
      if(!closest){
        const end=add(ray.from,ray.direction,100);
        segments.push({id:`S${++serial}`,rootId:ray.rootId,parentId:ray.parentId,from:ray.from,to:end,type:ray.type,power:ray.power,unassessed:true});
        terminate(ray,'unassessed',end,'out-of-domain');continue;
      }
      const {surface,point}=closest;
      const n=dot(ray.direction,surface.normal)<0?surface.normal:surface.normal.map(x=>-x);
      const id=`N${++serial}`,R=ray.power*surface.material.R,T=ray.power*surface.material.T,A=ray.power*surface.material.A;
      const incidentCos=Math.max(0,-dot(ray.direction,n));
      nodes.push({id,parentId:ray.parentId,rootId:ray.rootId,point,surfaceId:surface.id,role:surface.role,normal:n,incomingDirection:ray.direction,incidenceAngle:Math.acos(Math.min(1,incidentCos))*180/Math.PI,powerIn:ray.power,reflected:R,transmitted:T,absorbed:A,depth:ray.depth});
      segments.push({id:`S${++serial}`,rootId:ray.rootId,parentId:ray.parentId,nodeId:id,from:ray.from,to:point,type:ray.type,power:ray.power});
      ledger.absorbed+=A;
      const child=(power,direction,type)=>({rootId:ray.rootId,parentId:id,from:point,origin:add(point,direction,EPS*2),direction,power,depth:ray.depth+1,type,touched:true});
      if(R>0)queue.push(child(R,reflected(ray.direction,n),'reflected'));
      if(T>0){
        if(surface.role==='original')terminate(child(T,ray.direction,'transmitted'),'interior',point,'interior');
        else queue.push(child(T,ray.direction,'transmitted'));
      }
    }
  }
  const accounted=Object.entries(ledger).filter(([k])=>k!=='launched').reduce((s,[,v])=>s+v,0);
  ledger.residual=ledger.launched-accounted;
  return {roots,nodes,segments,terminals,ledger,surfaces};
}

export function traceCity(tile,options) {
  const {building,facade,alpha=0,scenario='adaptive',rho=.3,sun,dni=800}=options;
  const assembly=buildAssembly(building,facade,alpha,scenario,rho);
  const source=makeSource(assembly.envelope,sun,options.columns,options.rows);
  const bounds=tile.meta.bounds;
  const result=traceFinite({surfaces:assembly.surfaces,roots:dni>0&&sun[2]>0?source.roots:[],environment:(origin,dir,max)=>{
    const h=firstHit(origin,dir,tile,null,EPS,max);
    if(!h)return null;
    const out=bounds&&(h.point[0]<bounds.minX||h.point[0]>bounds.maxX||h.point[1]<bounds.minY||h.point[1]>bounds.maxY);
    return {distance:h.t,point:add(origin,dir,h.t),kind:h.kind,name:h.building?.name||'',unassessed:!!out||!!h.wall||h.kind==='roof'};
  }});
  // Compatibility paths contain the complete ancestry, including incident and internal segments.
  const paths=result.roots.filter(r=>result.nodes.some(n=>n.rootId===r.id)).map(r=>{
    const segs=result.segments.filter(s=>s.rootId===r.id);
    return {id:r.id,origin:r.origin,hops:segs.map(s=>({from:s.from,to:s.to,kind:s.type})),energy:r.power,kind:'root'};
  });
  return {...result,paths,panels:source.roots.length,occlusions:[],source:{...source,roots:undefined},model:OPTICS.revision,counts:{panels:source.roots.length,lit:paths.length,shaded:result.terminals.filter(t=>t.category==='occluded').length,backlit:dni>0?0:source.roots.length},warnings:['Zero-thickness sheets; constant assumed solar R/T/A.','Unknown neighboring surfaces stop at first contact; no fabricated mirror bounce.','Contact samples are not beam footprints, irradiance, luminance or glare.']};
}

export function finiteSummary(result){
  const ledger=result.ledger||{launched:0,residual:0};
  return {samples:result.panels??result.roots?.length??0,lit:new Set((result.nodes||[]).map(n=>n.rootId)).size,residual:ledger.residual,unassessed:ledger.launched?((ledger.unassessed||0)+(ledger.truncated||0))/ledger.launched:null,share:null,total:ledger.launched,ledger};
}
