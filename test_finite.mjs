import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {rectangle,intersectRectangle,traceFinite,reflected,dot,norm,buildAssembly,makeSource,traceCity} from './js/finite-optics.js';
import {prepareTile,rankSubjects} from './js/optics.js';
import {sunVector,solarPosition,localToUtc} from './js/solar.js';
const close=(a,b,t=1e-10)=>assert.ok(Math.abs(a-b)<t,`${a} ≠ ${b}`);
const wall=rectangle('old',[0,-2,-2],[0,4,0],[0,0,4],[1,0,0],{R:.3,T:.6},'original');
const fin=rectangle('fin',[1,-1,-1],[0,2,0],[0,0,2],[1,0,0],{R:.12,T:.65});
const root={id:'P1',origin:[2,0,0],direction:[-1,0,0],power:1};
assert.throws(()=>rectangle('bad',[0,0,0],[1,0,0],[0,1,0],[0,0,1],{R:.8,T:.3}));
close(intersectRectangle(root.origin,root.direction,fin).distance,1);
assert.equal(intersectRectangle([2,1.1,0],root.direction,fin),null,'finite edge must reject infinite-plane hit');
assert.equal(intersectRectangle([0,0,0],root.direction,fin),null,'intersection behind ray must be rejected');
assert.equal(intersectRectangle(root.origin,[0,1,0],fin),null,'parallel ray has no intersection');
for(const degrees of [0,15,40,70,89]){
  const t=degrees*Math.PI/180,d=[-Math.cos(t),0,-Math.sin(t)],n=[1,0,0],r=reflected(d,n);
  close(Math.hypot(...r),1);close(-dot(d,n),dot(r,n));close(r[2],d[2]);
}
const normal=norm([.7,.2,.4]);const direction=norm([-.5,-.6,-.8]);
const reflected3=reflected(direction,normal);close(Math.hypot(...reflected3),1);close(dot(reflected3,normal),-dot(direction,normal));

const coupled=traceFinite({surfaces:[fin,wall],roots:[root]});
assert.deepEqual(coupled.nodes.slice(0,3).map(n=>n.surfaceId),['fin','old','fin'],'returning ray must actually re-intersect finite fin');
close(coupled.nodes[1].powerIn,.65);close(coupled.nodes[2].powerIn,.65*.3);
close(coupled.nodes[2].transmitted,.65*.3*.65);
for(const node of coupled.nodes){
  close(node.powerIn,node.reflected+node.transmitted+node.absorbed);
  assert.ok(coupled.segments.some(s=>s.nodeId===node.id),'every split has an incoming segment');
  if(node.parentId)assert.ok(coupled.nodes.some(p=>p.id===node.parentId),'parent exists');
  const surface=coupled.surfaces.find(s=>s.id===node.surfaceId);
  close(dot(node.point.map((v,i)=>v-surface.origin[i]),surface.normal),0);
}
close(coupled.ledger.residual,0);
assert.equal(coupled.segments.filter(s=>s.type==='incident').length,1,'exactly one incident segment per active root');
assert.ok(coupled.terminals.some(t=>t.category==='interior'));

const gap=rectangle('offset-fin',[1,1,-1],[0,1,0],[0,0,2],[1,0,0],{R:.12,T:.65});
const bypass=traceFinite({surfaces:[gap,wall],roots:[root]});
assert.equal(bypass.nodes.length,1);assert.equal(bypass.nodes[0].surfaceId,'old');
close(bypass.nodes[0].reflected,.3); // A non-hit fin must not attenuate the gap ray.
close(bypass.ledger.interior,.6);close(bypass.ledger.residual,0);

// Uniform illumination over a homogeneous interior patch is grid-independent.
const uniformGrid=n=>Array.from({length:n*n},(_,i)=>({id:'G'+i,origin:[2,-.8+(i%n+.5)*1.6/n,-.8+(Math.floor(i/n)+.5)*1.6/n],direction:[-1,0,0],power:1/(n*n)}));
const coarse=traceFinite({surfaces:[fin,wall],roots:uniformGrid(2)});
const fine=traceFinite({surfaces:[fin,wall],roots:uniformGrid(8)});
for(const key of Object.keys(coarse.ledger))close(coarse.ledger[key],fine.ledger[key],1e-10);

const trunc=traceFinite({surfaces:[fin,wall],roots:[root],maxDepth:1});
close(trunc.ledger.absorbed,.23);close(trunc.ledger.truncated,.77);close(trunc.ledger.residual,0);
const cutoff=traceFinite({surfaces:[fin,wall],roots:[root],minFraction:.99});close(cutoff.ledger.truncated,.77);close(cutoff.ledger.residual,0);
const blocked=traceFinite({surfaces:[fin,wall],roots:[root],environment:()=>({distance:.1,point:[1.9,0,0],kind:'neighbor',unassessed:true})});
assert.equal(blocked.nodes.length,0);close(blocked.ledger.occluded,1);
const unknown=traceFinite({surfaces:[fin],roots:[root],environment:(o,d)=>d[0]>0?{distance:2,point:[o[0]+2,0,0],kind:'neighbor',unassessed:true}:null});
assert.equal(unknown.nodes.length,1,'unknown receiver must not generate a fabricated mirror interaction');close(unknown.ledger.residual,0);

const tile=prepareTile(JSON.parse(readFileSync(new URL('./data/central.json',import.meta.url))));
const subject=rankSubjects(tile,10).find(r=>r.building.id==='way/148554945');
const pos=solarPosition(localToUtc(2026,12,21,15,0,'Asia/Hong_Kong'),22.284,114.16),sun=sunVector(pos.elevationDeg,pos.azimuthDeg);
const opts={building:subject.building,facade:subject.cluster,sun,rho:.3,dni:800};
const source0=makeSource(buildAssembly(opts.building,opts.facade,0,'baseline').envelope,sun);
const source50=makeSource(buildAssembly(opts.building,opts.facade,50).envelope,sun);
assert.deepEqual(source0,source50,'all scenarios share one fixed source aperture and normalized input');
for(const alpha of [0,16,30,50]){
  const scene=traceCity(tile,{...opts,alpha});close(scene.ledger.residual,0,1e-9);
  assert.ok(scene.nodes.every(n=>n.surfaceId.startsWith('fin-')||n.surfaceId.startsWith('wall-')));
  assert.ok(scene.nodes.some(n=>n.role==='original'));
  const rootIds=new Set(scene.roots.map(r=>r.id));assert.ok(scene.nodes.every(n=>rootIds.has(n.rootId)));
}
const desktop=traceCity(tile,{...opts,alpha:16,stepH:12,stepV:15});
const phone=traceCity(tile,{...opts,alpha:16,stepH:14,stepV:18});assert.deepEqual(desktop.ledger,phone.ledger);assert.deepEqual(desktop.nodes,phone.nodes);
const dark=traceCity(tile,{...opts,dni:0});assert.equal(dark.nodes.length,0);assert.equal(dark.ledger.launched,0);
console.log('finite optics ok — finite edges, vector reflection, return paths, gaps, parent graph, R/T/A conservation, truncation, occlusion, unknown materials, common aperture, viewport invariance');
