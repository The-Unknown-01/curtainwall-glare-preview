import { MODEL, linkage, summarize, validateRecords, exampleRecords } from './twin.js';
const $=id=>document.getElementById(id);
const names={baseline:'原幕墙',parked:'外屏收拢',fixed:'固定外屏',adaptive:'可动外屏'};
const percent=v=>v===null?'—':(v*100).toFixed(1)+'%';
let api,latest,records=exampleRecords(),recordSource='synthetic-example',recordName='内置合成示例',replayTimer,sunTimer,toastTimer;
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3500);}
function download(name,data){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function setWorkspace(name){stopReplay();stopSun();document.body.dataset.workspace=name;document.querySelectorAll('[data-workspace]').forEach(b=>{if(b.tagName==='BUTTON'){b.classList.toggle('active',b.dataset.workspace===name);b.setAttribute('aria-pressed',b.dataset.workspace===name);}});document.querySelectorAll('[data-panel]').forEach(p=>p.hidden=p.dataset.panel!==name);$('workspace-title').textContent={overview:'一条入射，追踪每一次真实交互。',compare:'让每一种方案，都有同条件的对照。',replay:'让一片玻璃的动作，留下可追溯的记录。'}[name];if(latest)renderComparison();}
function stopReplay(){clearInterval(replayTimer);replayTimer=null;$('replay-play').textContent='▶ 播放';}
function stopSun(){clearInterval(sunTimer);sunTimer=null;$('sun-play').textContent='▶ 播放日照';}
function moduleDiagram(angle){
  // Draw the actual example linkage in R02's x-out/y-down frame.
  const k=linkage(angle),a=angle*Math.PI/180,scale=.225,x=61,y=14;
  const hx=x+60*scale,hy=y,bx=hx+240*Math.sin(a)*scale,by=y+240*Math.cos(a)*scale;
  const ex=hx+600*Math.sin(a)*scale,ey=y+600*Math.cos(a)*scale,cy=y+(k?.s||534)*scale;
  $('module-diagram').innerHTML=`<svg viewBox="0 0 250 170" role="img" aria-label="上铰外屏，展开 ${angle.toFixed(1)} 度"><defs><linearGradient id="glass"><stop stop-color="#d3ebce"/><stop offset="1" stop-color="#bad9cb"/></linearGradient></defs><path d="M44 12v142" stroke="#ced9ca" stroke-width="6"/><path d="M61 14v140" stroke="#809d8a" stroke-width="4"/><path d="M57 24v120M65 24v120" stroke="#d6e0cf" stroke-width="1" stroke-dasharray="2 3"/><path d="M${hx} ${hy}V149" stroke="#acc4ab" stroke-dasharray="3 4"/><path d="M${hx} ${hy}L${ex} ${ey}" stroke="#176b53" stroke-width="9"/><path d="M${hx+1} ${hy+5}L${ex+1} ${ey-4}" stroke="url(#glass)" stroke-width="5"/><path d="M${x} ${cy}L${bx} ${by}" stroke="#c4914e" stroke-width="3"/><rect x="${x-5}" y="${cy-4}" width="10" height="8" rx="2" fill="#d9b46d"/>${[[hx,hy],[bx,by],[x,cy]].map(([cx,cy])=>`<circle cx="${cx}" cy="${cy}" r="3" fill="white" stroke="#608a6c" stroke-width="1.4"/>`).join('')}<text x="${Math.min(ex+13,196)}" y="${Math.min(ey-20,140)}" fill="#507c51" font-size="12">${angle.toFixed(0)}°</text><text x="15" y="166" fill="#9aaa92" font-size="8">固定原幕墙</text><text x="154" y="166" fill="#8b9e7f" font-size="8">外屏 / 室外 →</text></svg>`;
}
function renderComparison(){
  if(!latest)return;
  const rows=api.compare();
  $('comparison-table').innerHTML=rows.map(r=>`<div class="comparison-item ${r.scenario===latest.state.scenario?'active':''}"><span>${names[r.scenario]}</span><b>${r.metrics.lit} 根</b><small>目标受光采样 / ${r.metrics.samples}</small><small>能量残差 ${Math.abs(r.metrics.residual).toExponential(1)}</small></div>`).join('');
}
function render(detail){latest=detail;const metrics=summarize(detail.result),base=summarize(detail.baseline),s=detail.state;
  $('metric-share').textContent=metrics.lit+' / '+metrics.samples;
  $('metric-delta').textContent='入射采样';$('metric-delta').className='neutral';
  const residual=metrics.total?Math.abs(metrics.residual)/metrics.total*100:0;
  $('metric-daylight').innerHTML=(residual<1e-8?'＜10⁻⁸':residual.toExponential(1))+'<em>%</em>';
  $('metric-angle').innerHTML=s.scenario==='baseline'?'—':s.alpha.toFixed(0)+'<em>°</em>';
  $('metric-state').textContent=names[s.scenario];$('scenario-caption').textContent=names[s.scenario];
  $('alpha').disabled=s.scenario!=='adaptive';
  $('metric-travel').textContent=s.scenario==='baseline'?'未安装外屏':`行程示例 ${linkage(s.alpha)?.travel.toFixed(1)||'—'} mm · 非实装尺寸`;
  document.querySelectorAll('[data-scenario]').forEach(b=>{b.classList.toggle('selected',b.dataset.scenario===s.scenario);b.setAttribute('aria-pressed',b.dataset.scenario===s.scenario);});
  $('sample-status').textContent=`${metrics.samples} 采样 · 固定计算网格`;
  moduleDiagram(s.scenario==='baseline'?0:s.alpha);
  if(document.body.dataset.workspace==='compare')renderComparison();
}
function renderReplay(index,apply=false){
  const r=records[index],w=600,h=84,x=i=>12+i/(records.length-1)*(w-24),y=v=>h-12-v/50*(h-22);
  const line=key=>records.map((v,i)=>v[key]===null?null:`${x(i).toFixed(1)},${y(v[key]).toFixed(1)}`).filter(Boolean).join(' ');
  $('replay-chart').innerHTML=`<path d="M12 15H588M12 44H588M12 72H588" stroke="#edf1e7"/><polyline points="${line('target_deg')}" fill="none" stroke="#c4cfb8" stroke-dasharray="4 4" stroke-width="1.5"/><polyline points="${line('angle_deg')}" fill="none" stroke="#4e8154" stroke-width="2"/><path d="M${x(index)} 6V78" stroke="#e1af72" stroke-width="1"/><circle cx="${x(index)}" cy="${y(r.angle_deg)}" r="3.5" fill="#176b53"/><text x="15" y="11" fill="#a9b69b" font-size="8">50°</text><text x="490" y="10" fill="#889d79" font-size="8">虚线：目标 / 实线：记录</text>`;
  $('replay-position').max=records.length-1;$('replay-position').value=index;$('replay-angle').textContent=r.angle_deg.toFixed(1)+'°';$('replay-time').textContent=new Date(r.timestamp).toLocaleTimeString('zh-CN',{timeZone:'Asia/Hong_Kong',hour12:false});$('replay-source').textContent=recordSource==='synthetic-example'?'合成示例 · 非实测':'用户导入 · 未核验';
  if(apply){api.update({scenario:'adaptive',alpha:r.angle_deg});$('module-source').textContent=recordSource==='synthetic-example'?'合成回放':'用户导入记录';}
}
export function parseCsv(text){
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(!quoted&&(c===','||c==='\n')){row.push(cell.replace(/\r$/,''));cell='';if(c==='\n'){if(row.some(v=>v.trim()))rows.push(row);row=[];}}else cell+=c;}
  if(quoted)throw new Error('CSV引号未闭合');if(cell||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}const headers=rows.shift()?.map(v=>v.trim().replace(/^\uFEFF/,''));if(!headers?.includes('timestamp')||!headers.includes('angle_deg'))throw new Error('CSV需要 timestamp 和 angle_deg 列');return rows.map(r=>Object.fromEntries(headers.map((key,i)=>[key,r[i]??''])));
}
export function initDashboard(client){api=client;
  document.querySelectorAll('button[data-workspace]').forEach(b=>b.onclick=()=>setWorkspace(b.dataset.workspace));
  document.querySelectorAll('[data-scenario]').forEach(b=>b.onclick=()=>{stopReplay();stopSun();$('module-source').textContent='模拟参数';api.update({scenario:b.dataset.scenario});});
  $('open-replay').onclick=()=>setWorkspace('replay');
  for(const id of ['about-open','model-details'])$(id).onclick=()=>$('about').showModal();$('about-close').onclick=()=>$('about').close();$('about').addEventListener('click',e=>{if(e.target===$('about')){const r=$('about').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('about').close();}});
  $('recommend').onclick=()=>{stopReplay();stopSun();$('recommend').disabled=true;requestAnimationFrame(()=>{try{const best=api.recommend();if(best){api.update({scenario:'adaptive',alpha:best.alpha});$('recommend-note').textContent=`当前简化模型候选 ${best.alpha}° · 非安全许可，出域仍待评估`;}else $('recommend-note').textContent='当前没有可计算的直射反射，无法给出候选角度。';}finally{$('recommend').disabled=false;}});};
  $('reset-view').onclick=()=>api.overview();
  $('sun-play').onclick=()=>{if(sunTimer){stopSun();return;}stopReplay();$('sun-play').textContent='Ⅱ 暂停日照';sunTimer=setInterval(()=>{let t=Number($('clock').value)+20;if(t>1110){stopSun();return;}$('clock').value=t;$('clock').dispatchEvent(new Event('input'));},650);};
  $('replay-position').oninput=()=>{stopReplay();stopSun();renderReplay(Number($('replay-position').value),true);};
  $('replay-play').onclick=()=>{if(replayTimer){stopReplay();return;}stopSun();let i=Number($('replay-position').value);if(i===records.length-1)i=0;renderReplay(i,true);$('replay-play').textContent='Ⅱ 暂停';replayTimer=setInterval(()=>{i++;if(i>=records.length){stopReplay();return;}renderReplay(i,true);},300);};
  $('import-file').onchange=async e=>{stopReplay();const file=e.target.files[0];if(!file)return;try{if(file.size>2*1024*1024)throw new Error('文件上限2MB');const text=await file.text();const data=file.name.toLowerCase().endsWith('.csv')?parseCsv(text):JSON.parse(text.replace(/^\uFEFF/,''));const validated=validateRecords(Array.isArray(data)?data:data.records);records=validated;recordSource='user-import-unverified';recordName=file.name;renderReplay(0,true);$('import-status').textContent=`已导入 ${records.length} 条记录：${file.name}。仅验证格式，未核验测量质量。`;toast('记录已导入，可拖动回放');}catch(err){$('import-status').textContent='导入失败：'+err.message;toast('导入失败，原记录保留');}finally{e.target.value='';}};
  $('example-download').onclick=()=>download('solar-fin-example.json',exampleRecords());
  $('export').onclick=()=>{if(!latest)return;const {state,result,baseline,sun,meta}=latest;download('solar-fin-run.json',{schema:'cwisa-demo/2',created_at:new Date().toISOString(),model:MODEL,assumptions:['Concept geometry only; not measured glare or engineering certification.','Finite zero-thickness sheets; constant assumed solar R/T/A.','Complete parent-child graph; every actual finite-sheet crossing splits power.','Unknown neighbors stop at contact; no fabricated mirror bounce.','Out-of-domain paths remain unassessed.'],state,sun,scene:{origin:meta.origin,fetched:meta.fetched,attribution:meta.attribution},metrics:summarize(result),baseline_metrics:summarize(baseline),paths:result.paths,graph:{roots:result.roots,nodes:result.nodes,segments:result.segments,terminals:result.terminals},ledger:result.ledger,surfaces:result.surfaces,source:result.source,comparison:api.compare(),replay:{source:recordSource,name:recordName,index:Number($('replay-position').value),records}});toast('配置、完整光路与回放来源已导出');};
  document.addEventListener('twin:update',e=>render(e.detail));
  $('controls').addEventListener('input',e=>{if(e.target.id!=='clock'){stopSun();stopReplay();$('module-source').textContent='模拟参数';}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stopSun();stopReplay();}});
  renderReplay(0);
}
