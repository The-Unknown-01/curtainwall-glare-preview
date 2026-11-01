const $=id=>document.getElementById(id);
const C={incident:'#bd8a23',reflected:'#cf642f',transmitted:'#367fae'};
const pct=x=>(100*x).toFixed(1)+'%';
const label={receiver:'已交付接收面',interior:'透射进入室内',occluded:'到达前被遮挡',unassessed:'未评估 / 未知材料',truncated:'追踪截断',absorbed:'材料吸收'};
let api,last;
function clip(a,b,box){let lo=0,hi=1;const d=[b[0]-a[0],b[1]-a[1]];for(let j=0;j<2;j++){if(Math.abs(d[j])<1e-12){if(a[j]<box[j][0]||a[j]>box[j][1])return null;}else{let t1=(box[j][0]-a[j])/d[j],t2=(box[j][1]-a[j])/d[j];if(t1>t2)[t1,t2]=[t2,t1];lo=Math.max(lo,t1);hi=Math.min(hi,t2);if(lo>hi)return null;}}return [[a[0]+lo*d[0],a[1]+lo*d[1]],[a[0]+hi*d[0],a[1]+hi*d[1]]];}
function project(svg,detail,plane){
  const {result,state}=detail,nodes=result.nodes.filter(n=>n.rootId===state.rayId),center=nodes[0]?.point;
  if(!center){svg.innerHTML='';return;}
  const first=result.surfaces.find(s=>s.id===nodes[0].surfaceId),n=first.normal;
  const nh=Math.hypot(n[0],n[1])||1,out=[n[0]/nh,n[1]/nh,0],tangent=[-out[1],out[0],0];
  const axes=plane==='side'?[out,[0,0,1]]:[tangent,out];
  const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
  const xy=p=>axes.map(axis=>dot(p.map((v,i)=>v-center[i]),axis));
  const extent=nodes.map(n=>xy(n.point));
  for(const surface of result.surfaces.filter(s=>s.role==='fin'&&nodes.some(n=>n.surfaceId===s.id)))extent.push(...surface.corners.map(xy));
  const box=[0,1].map(axis=>[Math.min(-2,...extent.map(p=>p[axis]))-1,Math.max(2,...extent.map(p=>p[axis]))+1]);
  const w=Math.max(260,svg.clientWidth),h=200;
  const scale=Math.min((w-36)/(box[0][1]-box[0][0]),(h-48)/(box[1][1]-box[1][0]));
  const mid=box.map(b=>(b[0]+b[1])/2),map=p=>[w/2+(p[0]-mid[0])*scale,h/2-(p[1]-mid[1])*scale];
  svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
  let html=`<defs>${Object.entries(C).map(([k,c])=>`<marker id="${plane}-${k}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L8 4L0 8Z" fill="${c}"/></marker>`).join('')}</defs>`;
  const touched=new Set(nodes.map(n=>n.surfaceId));
  for(const surface of result.surfaces.filter(s=>touched.has(s.id))){
    for(let i=0;i<4;i++){const hit=clip(xy(surface.corners[i]),xy(surface.corners[(i+1)%4]),box);if(!hit)continue;const a=map(hit[0]),b=map(hit[1]);html+=`<path d="M${a}L${b}" stroke="${surface.role==='fin'?'#618f78':'#a0b2ba'}" stroke-width="2" fill="none"/>`;}
  }
  for(const segment of result.segments.filter(s=>s.rootId===state.rayId)){
    const line=clip(xy(segment.from),xy(segment.to),box);if(!line)continue;const a=map(line[0]),b=map(line[1]);if(Math.hypot(a[0]-b[0],a[1]-b[1])<1)continue;
    html+=`<path d="M${a}L${b}" stroke="${C[segment.type]}" stroke-width="1.7" fill="none" marker-end="url(#${plane}-${segment.type})"/>`;
  }
  nodes.forEach((node,i)=>{const p=xy(node.point);if(p.some((v,j)=>v<box[j][0]||v>box[j][1]))return;const [x,y]=map(p);html+=`<circle cx="${x}" cy="${y}" r="${i===state.eventIndex?4:2}" fill="#244d3c"/>`;if(i===state.eventIndex)html+=`<text x="${Math.min(x+7,w-35)}" y="${Math.max(y-5,29)}" fill="#375b44" font-size="11">${node.id}</text>`;});
  html+=`<text x="18" y="14" fill="#67806c" font-size="11">${plane==='side'?'侧视：向外 / 高度':'俯视：沿立面 / 向外'}（m）</text><text x="18" y="${h-2}" fill="#8a9b8f" font-size="10">局部正交投影 · 不从投影图读取入射角</text>`;
  html+=`<path d="M${w-58} ${h-24}h${scale}" stroke="#687e6b" stroke-width="1"/><text x="${w-58}" y="${h-28}" fill="#7d9079" font-size="10">1 m</text>`;svg.innerHTML=html;
}
function receiverMap(detail){
  const svg=$('receiver-map'),b=detail.meta.bounds,w=Math.max(280,svg.clientWidth),h=190;
  svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
  const scale=Math.min((w-30)/(b.maxX-b.minX),(h-25)/(b.maxY-b.minY));
  const cx=(b.maxX+b.minX)/2,cy=(b.maxY+b.minY)/2;
  const point=p=>[w/2+(p[0]-cx)*scale,h/2-(p[1]-cy)*scale];
  let html=(detail.context?.buildings||[]).map(b=>`<polygon points="${b.outer.map(point).join(' ')}" fill="#e0e8df" stroke="#c6d2c5" stroke-width=".4"/>`).join('');
  const terminals=detail.result.terminals.filter(t=>t.touched&&['receiver','unassessed'].includes(t.category)&&t.kind!=='out-of-domain'&&t.point[0]>=b.minX&&t.point[0]<=b.maxX&&t.point[1]>=b.minY&&t.point[1]<=b.maxY);
  html+=terminals.map(t=>{const [x,y]=point(t.point);return `<circle role="button" tabindex="0" aria-label="选择 ${t.rootId} 接收命中" data-root="${t.rootId}" data-parent="${t.parentId}" cx="${x}" cy="${y}" r="${t.rootId===detail.state.rayId?4:2.5}" fill="${t.rootId===detail.state.rayId?'#d86c39':'#8ca38b'}" opacity=".85"/>`;}).join('');
  html+=`<text x="10" y="14" fill="#71866c" font-size="11">北 ↑ · 平面命中点（非辐照度热图）</text>`;svg.innerHTML=html;
}
function render(detail){
  last=detail;const {result,state}=detail,nodes=result.nodes.filter(n=>n.rootId===state.rayId),root=result.roots.find(r=>r.id===state.rayId),node=nodes[state.eventIndex];
  $('root-select').innerHTML=result.paths.map(p=>`<option value="${p.id}">${p.id} · ${result.nodes.filter(n=>n.rootId===p.id).length} 个交点</option>`).join('');$('root-select').value=state.rayId||'';
  $('ray-bundle').checked=state.bundle;
  for(const b of document.querySelectorAll('[data-scene]'))b.setAttribute('aria-pressed',b.dataset.scene===state.display);
  $('event-prev').disabled=state.eventIndex<=0;$('event-next').disabled=state.eventIndex>=nodes.length-1;
  $('event-readout').textContent=node?`交点 ${state.eventIndex+1}/${nodes.length} · ${node.role==='fin'?'外屏':'原幕墙'} · 三维入射角 ${node.incidenceAngle.toFixed(1)}°`:'当前没有目标交点';
  $('event-optics').textContent=node?`局部能量分配：反射 ${pct(node.reflected/node.powerIn)} / 透射 ${pct(node.transmitted/node.powerIn)} / 吸收 ${pct(node.absorbed/node.powerIn)}`:'更换时刻或建筑以检查受光路径';
  const ends=result.terminals.filter(t=>t.rootId===state.rayId);
  function tree(n){
    const i=nodes.indexOf(n),incoming=result.segments.find(s=>s.nodeId===n.id),base=root?.power||1;
    const depth=Math.min(n.depth,4)*7;
    let html=`<button class="event-node ${i===state.eventIndex?'selected':''}" data-event="${i}" style="margin-left:${depth}px"><span>${n.id} · ${n.role==='fin'?'外屏':'原幕墙'}<small>${n.parentId?'来自 '+n.parentId:'来自太阳 '+n.rootId} · ${incoming?.type==='transmitted'?'透射':incoming?.type==='reflected'?'反射':'入射'}</small></span><b>${pct(n.powerIn/base)}</b></button>`;
    html+=`<div class="event-leaf" style="margin-left:${depth+10}px">↳ 吸收 ${pct(n.absorbed/base)}</div>`;
    for(const child of nodes.filter(c=>c.parentId===n.id))html+=tree(child);
    for(const end of ends.filter(t=>t.parentId===n.id))html+=`<div class="event-leaf" style="margin-left:${depth+10}px">↳ ${end.type==='reflected'?'反射':end.type==='transmitted'?'透射':'剩余'} → ${label[end.category]} <b>${pct(end.power/base)}</b></div>`;
    return html;
  }
  $('path-tree').innerHTML=nodes.filter(n=>!n.parentId).map(tree).join('')||'<p class="fine">没有光线命中目标立面。</p>';
  const selected=result.terminals.filter(t=>t.rootId===state.rayId),absorbed=nodes.reduce((sum,n)=>sum+n.absorbed,0);
  const categories=['absorbed','interior','receiver','unassessed','truncated'];
  $('direction-bars').innerHTML=categories.map(k=>{const value=k==='absorbed'?absorbed:selected.filter(t=>t.category===k).reduce((s,t)=>s+t.power,0);return `<div class="direction-row"><div class="direction-label"><span>${label[k]}</span><b>${root?pct(value/root.power):'—'}</b></div><div class="bar-track"><i style="width:${root?100*value/root.power:0}%;background:#8fa987"></i></div></div>`;}).join('');
  project($('projection-side'),detail,'side');project($('projection-top'),detail,'top');receiverMap(detail);
  $('receiver-list').innerHTML=result.terminals.filter(t=>t.touched&&t.kind!=='out-of-domain'&&t.kind!=='interior'&&t.kind!=='cutoff').slice(0,12).map(t=>`<button class="receiver-row" data-root="${t.rootId}" data-parent="${t.parentId}">${t.rootId} · z=${t.point[2].toFixed(1)}m · ${t.kind==='neighbor'?'邻楼':t.kind==='street'?'街道':t.kind==='water'?'水面':t.kind==='roof'?'屋面':'表面'}<span>${label[t.category]} · ${t.parentId}</span></button>`).join('')||'<p class="fine">当前没有模型范围内的外部接收命中。</p>';
}
export function initPathInspector(client){
  api=client;$('root-select').onchange=e=>api.selectRay(e.target.value);
  $('ray-bundle').onchange=e=>api.bundle(e.target.checked);
  document.querySelectorAll('[data-scene]').forEach(b=>b.onclick=()=>api.scene(b.dataset.scene));
  $('event-prev').onclick=()=>api.event(last.state.eventIndex-1);$('event-next').onclick=()=>api.event(last.state.eventIndex+1);
  $('path-tree').onclick=e=>{const b=e.target.closest('[data-event]');if(b)api.event(Number(b.dataset.event));};
  for(const id of ['receiver-map','receiver-list']){
    $(id).onclick=e=>{const b=e.target.closest('[data-root]');if(b){const id=b.dataset.root,parent=b.dataset.parent;api.selectRay(id);const i=last.result.nodes.filter(n=>n.rootId===id).findIndex(n=>n.id===parent);if(i>=0)api.event(i);}};
    $(id).onkeydown=e=>{if(e.key==='Enter'||e.key===' '){const b=e.target.closest('[data-root]');if(b){e.preventDefault();api.selectRay(b.dataset.root);}}};
  }
  document.addEventListener('twin:update',e=>render(e.detail));
}
