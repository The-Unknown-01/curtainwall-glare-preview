import * as THREE from 'three';

// Display geometry only. No meshes in this file enter the finite optical solver.
const point=(e,n,z=0)=>new THREE.Vector3(e,z,-n);
export function seedOf(id){let h=2166136261;for(const c of String(id)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function random(seed){return ()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;};}
export function inside(p,ring){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;}
export function inBuilding(p,b){return inside(p,b.outer)&&!(b.holes||[]).some(h=>inside(p,h));}
export function segmentDistance(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],d=dx*dx+dy*dy,t=d?THREE.MathUtils.clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dy)/d,0,1):0;return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);}

function facadeTexture(kind,renderer){
  const c=document.createElement('canvas');c.width=512;c.height=512;const g=c.getContext('2d'),rng=random(seedOf(kind));
  const glass=kind!=='stone';g.fillStyle=glass?(kind==='silver'?'#829da8':'#365a6e'):'#b0afa5';g.fillRect(0,0,512,512);
  // Eight bays / four floors; metre-based UVs prevent giant windows on tall towers.
  for(let floor=0;floor<4;floor++)for(let bay=0;bay<8;bay++){
    const x=bay*64,y=floor*128,v=rng();
    if(glass){
      const grad=g.createLinearGradient(x,y,x+64,y+115);grad.addColorStop(0,kind==='silver'?'#b0c4cc':'#8cabb9');grad.addColorStop(.45,kind==='silver'?'#809ea9':'#607f94');grad.addColorStop(1,kind==='silver'?'#a4bfca':'#7898a8');g.fillStyle=grad;g.fillRect(x+3,y+4,58,105);
      g.fillStyle=`rgba(16,34,43,${.035+v*.1})`;g.fillRect(x+4,y+5,56,103);
      if(v>.78){g.fillStyle='rgba(223,200,150,.22)';g.fillRect(x+5,y+50,54,53);}
      g.fillStyle='rgba(190,215,221,.32)';g.fillRect(x+6,y+6,2,99);
      g.fillStyle='#293e46';g.fillRect(x,y+110,64,18);g.fillStyle='#acc1c7';g.fillRect(x,y+109,64,2);
    }else{
      g.fillStyle=`rgb(${158+v*30},${158+v*26},${149+v*25})`;g.fillRect(x+2,y+2,61,125);
      g.fillStyle='#4a6269';g.fillRect(x+11,y+18,42,79);g.fillStyle='#91acb4';g.fillRect(x+13,y+20,18,74);g.fillStyle='#c6c5b9';g.fillRect(x+30,y+18,2,78);g.fillRect(x+8,y+98,48,5);
    }
    g.fillStyle=glass?'#b1bec0':'#777b77';g.fillRect(x,y,2,128);
  }
  const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());return texture;
}
function buffer(){return {p:[],uv:[],c:[]};}
function tri(b,a,c,d,uvs,color){for(const [i,v] of [a,c,d].entries()){b.p.push(...v.toArray());if(uvs)b.uv.push(...uvs[i]);if(color)b.c.push(color.r,color.g,color.b);}}
function wall(b,a,c,z0,z1,color){const length=Math.hypot(c[0]-a[0],c[1]-a[1]),u=length/24,v=(z1-z0)/14.4;if(length<.1)return;
  const p=[point(...a,z0),point(...c,z0),point(...c,z1),point(...a,z1)];tri(b,p[0],p[1],p[2],[[0,0],[u,0],[u,v]],color);tri(b,p[0],p[2],p[3],[[0,0],[u,v],[0,v]],color);
}
function roof(b,building,color){const rings=[building.outer,...building.holes],flat=rings.flat(),faces=THREE.ShapeUtils.triangulateShape(rings[0].map(p=>new THREE.Vector2(...p)),rings.slice(1).map(r=>r.map(p=>new THREE.Vector2(...p))));for(const f of faces){let p=f.map(i=>point(...flat[i],building.height));if(new THREE.Vector3().crossVectors(p[1].clone().sub(p[0]),p[2].clone().sub(p[0])).y<0)p=[p[0],p[2],p[1]];tri(b,...p,null,color);}}
function mesh(b,material){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(b.p,3));if(b.uv.length)g.setAttribute('uv',new THREE.Float32BufferAttribute(b.uv,2));if(b.c.length)g.setAttribute('color',new THREE.Float32BufferAttribute(b.c,3));g.computeVertexNormals();const m=new THREE.Mesh(g,material);m.castShadow=m.receiveShadow=true;return m;}
function batches(){return {boxes:[],poles:[],leaves:[],wheels:[]};}
function box(batch,p,size,color,angle=0){batch.boxes.push({p:point(...p),s:size,color,angle});}
function lineBox(batch,a,b,z,width,height,color){const length=Math.hypot(b[0]-a[0],b[1]-a[1]);box(batch,[(a[0]+b[0])/2,(a[1]+b[1])/2,z],[length,height,width],color,Math.atan2(b[1]-a[1],b[0]-a[0]));}
function addBatches(group,batch){
  const geometries={boxes:new THREE.BoxGeometry(1,1,1),poles:new THREE.CylinderGeometry(.5,.5,1,7),leaves:new THREE.IcosahedronGeometry(1,1),wheels:new THREE.CylinderGeometry(.5,.5,1,12)};
  for(const [key,rows] of Object.entries(batch)){
    if(!rows.length)continue;const material=new THREE.MeshStandardMaterial({roughness:key==='leaves'?.95:.66,metalness:key==='poles'?.5:.08});
    const m=new THREE.InstancedMesh(geometries[key],material,rows.length),dummy=new THREE.Object3D();m.name='detail-'+key;
    rows.forEach((r,i)=>{dummy.position.copy(r.p);dummy.scale.set(...r.s);dummy.rotation.set(key==='wheels'?Math.PI/2:0,r.angle||0,0,'YXZ');dummy.updateMatrix();m.setMatrixAt(i,dummy.matrix);m.setColorAt(i,new THREE.Color(r.color));});
    m.castShadow=m.receiveShadow=true;m.computeBoundingSphere();m.instanceMatrix.needsUpdate=true;m.instanceColor.needsUpdate=true;group.add(m);
  }
}

export function buildDistrict(tile,focus,renderer,{low=false}={}){
  const group=new THREE.Group();group.name='Central-detailed-district';const batch=batches(),detail=new THREE.Group();detail.name='procedural-architecture';
  const buckets={blue:buffer(),silver:buffer(),stone:buffer()},roofs=buffer();let ribs=0,plant=0;
  for(const b of tile.buildings){
    const rng=random(seedOf(b.id)),height=b.height-(b.minHeight||0),kind=height<32||['civic','government','church'].includes(b.kind)?'stone':rng()>.5?'silver':'blue';
    const color=new THREE.Color().setHSL(.55+rng()*.03,.035+rng()*.04,.80+rng()*.16),z0=b.minHeight||0;
    // The GIS footprint and top height remain identical on every quality tier.
    for(const ring of [b.outer,...b.holes])for(let i=0;i<ring.length;i++)wall(buckets[kind],ring[i],ring[(i+1)%ring.length],z0,b.height,color);
    roof(roofs,b,new THREE.Color(kind==='stone'?0x9e9e94:0x7c8e96));
    const c=b.centroid,near=Math.hypot(c[0]-focus.centroid[0],c[1]-focus.centroid[1])<(low?240:440);
    if(!near&&height<110)continue;
    for(const edge of b.edges){
      if(edge.hole)continue;const a=[edge.ax,edge.ay],d=[edge.bx-edge.ax,edge.by-edge.ay],length=Math.hypot(...d);if(length<3)continue;
      const nx=edge.nx,ny=edge.ny,off=.11,A=[a[0]+nx*off,a[1]+ny*off],B=[edge.bx+nx*off,edge.by+ny*off];
      // Copings stay below the recorded top; all ornaments are indicative.
      lineBox(batch,A,B,b.height-.22,.28,.44,0xb7c0bf);
      if(height>25){
        const step=kind==='stone'?7.2:14.4;
        for(let z=z0+step;z<b.height-1;z+=step)lineBox(batch,A,B,z,.24,kind==='stone'?.26:.15,0x9eafb2);
        if(height>55&&length>7){const bays=Math.max(1,Math.floor(length/(low?8:5)));
          for(let j=0;j<=bays;j++){const t=j/bays;box(batch,[A[0]+d[0]*t,A[1]+d[1]*t,z0+height/2],[.16,height,.24],kind==='blue'?0x94acb4:0xc1cccd,Math.atan2(d[1],d[0]));ribs++;}
        }
      }
      // Recessed entrance canopy at street level, only on long edges.
      if(near&&z0<1&&length>22&&height>14){lineBox(batch,[(A[0]+B[0])/2-d[0]*.16+nx*.8,(A[1]+B[1])/2-d[1]*.16+ny*.8],[(A[0]+B[0])/2+d[0]*.16+nx*.8,(A[1]+B[1])/2+d[1]*.16+ny*.8],4.2,1.8,.16,0x5e6e70);}
    }
    if(height>16&&b.area>250){
      // Equipment sampled entirely inside the real roof, including hole tests.
      const bounds=b.bbox;for(let k=0;k<(low?2:4);k++){
        const x=bounds.min[0]+(bounds.max[0]-bounds.min[0])*(.25+rng()*.5),y=bounds.min[1]+(bounds.max[1]-bounds.min[1])*(.25+rng()*.5),w=2+rng()*3,l=2+rng()*3;
        if(![[x-w/2,y-l/2],[x+w/2,y-l/2],[x+w/2,y+l/2],[x-w/2,y+l/2],[x,y]].every(p=>inBuilding(p,b)))continue;
        box(batch,[x,y,b.height+.65],[w,1.3,l],0x9ca8aa);box(batch,[x,y,b.height+1.32],[w*.8,.06,l*.8],0x485a61);plant++;
      }
    }
  }
  for(const [kind,data] of Object.entries(buckets)){
    const material=new THREE.MeshStandardMaterial({map:facadeTexture(kind,renderer),vertexColors:true,side:THREE.DoubleSide,roughness:kind==='stone'?.87:.29,metalness:kind==='stone'?.03:.22,envMapIntensity:kind==='stone'?.35:.85});
    if(data.p.length)group.add(mesh(data,material));
  }
  group.add(mesh(roofs,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.86,side:THREE.DoubleSide})));
  addBatches(detail,batch);group.add(detail);group.userData={buildings:tile.buildings.length,ribs,roofEquipment:plant,detail};return group;
}

function strip(buf,a,b,half,z,color){const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(len<.05)return;const px=-dy/len*half,py=dx/len*half,p=[point(a[0]+px,a[1]+py,z),point(b[0]+px,b[1]+py,z),point(b[0]-px,b[1]-py,z),point(a[0]-px,a[1]-py,z)];tri(buf,p[0],p[1],p[2],null,color);tri(buf,p[0],p[2],p[3],null,color);}
export function buildStreetLife(tile,{low=false}={}){
  const group=new THREE.Group();group.name='Central-streets';const batch=batches(),road=buffer(),walk=buffer(),marks=buffer();let trees=0,lamps=0,vehicles=0;
  const occupied=p=>tile.buildings.some(b=>p[0]>=b.bbox.min[0]-1&&p[0]<=b.bbox.max[0]+1&&p[1]>=b.bbox.min[1]-1&&p[1]<=b.bbox.max[1]+1&&inBuilding(p,b))||tile.water.some(r=>inside(p,r));
  const onRoad=(p,own)=>tile.roads.some(r=>r!==own&&!['pedestrian','footway','steps','path'].includes(r.kind)&&r.pts.some((a,i)=>i&&segmentDistance(p,r.pts[i-1],a)<(r.width||6)/2+1));
  for(const r of tile.roads){
    const pedestrian=['pedestrian','footway','steps','path','cycleway'].includes(r.kind),half=(r.width||6)/2,rng=random(seedOf(r.id));
    for(let i=1;i<r.pts.length;i++){
      const a=r.pts[i-1],b=r.pts[i],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(len<.1)continue;
      strip(walk,a,b,half+(pedestrian?.25:1.6),.035,new THREE.Color(pedestrian?0xb3b1a4:0xa5aaa4));
      if(pedestrian)continue;
      strip(road,a,b,half,.065,new THREE.Color(0x434c50));
      const at=(t,side=0)=>[a[0]+dx*t-dy/len*side,a[1]+dy*t+dx/len*side];
      // Each source way is split at junctions; keep markings away from its ends.
      if(len>22&&half>=4)for(let d=8;d<len-8;d+=9)strip(marks,at(d/len),at(Math.min(d+3,len-7)/len),.07,.085,new THREE.Color(0xd6d7c5));
      if(len>28){
        for(const side of [-1,1])for(const d of [0,.18])strip(marks,at(3/len,side*(half-.3-d)),at((len-3)/len,side*(half-.3-d)),.055,.088,new THREE.Color(0xc6ae62));
      }
      const angle=Math.atan2(dy,dx);
      if(len>32&&vehicles<(low?32:72)&&rng()>.28){
        const p=at(.25+rng()*.5,half*.43),bus=half>5&&rng()>.76,bodyColor=bus?0xb66042:[0xa74c3d,0xc8c9bd,0x344b5b,0xd4c7ad][Math.floor(rng()*4)];
        if(!occupied(p)){
          box(batch,[...p,bus?1.65:.8],[bus?10:4.4,bus?3.1:1.3,bus?2.4:1.8],bodyColor,angle);
          box(batch,[...p,bus?2.4:1.6],[bus?9:2.5,bus?1.4:.65,bus?2.43:1.55],0x29434e,angle);vehicles++;
          if(bus)box(batch,[...p,2.4],[10,.16,2.46],bodyColor,angle);
          for(const forward of [-1,1])for(const side of [-1,1]){
            const along=forward*(bus?3.2:1.35),across=side*(bus?1.15:.86),x=p[0]+dx/len*along-dy/len*across,y=p[1]+dy/len*along+dx/len*across;
            batch.wheels.push({p:point(x,y,bus?.48:.4),s:[bus?.92:.7,.18,bus?.92:.7],color:0x252b2c,angle});
          }
        }
      }
      for(let d=15;d<len-12;d+=(low?65:40)){
        const side=rng()>.5?1:-1,p=at(d/len,side*(half+.9));
        if(occupied(p)||onRoad(p,r))continue;
        batch.poles.push({p:point(...p,3.8),s:[.18,7.6,.18],color:0x576668});
        const end=at(d/len,side*(half-.9));lineBox(batch,p,end,7.55,.11,.11,0x667476);box(batch,[...end,7.48],[.65,.13,.28],0xc2cabd,angle);lamps++;
        if(trees<(low?60:140)){
          const tp=at((d+6)/len,side*(half+1.6));if(occupied(tp)||onRoad(tp,r))continue;
          box(batch,[...tp,.25],[2,.5,2],0x7e8980);batch.poles.push({p:point(...tp,2),s:[.26,3.7,.26],color:0x6c6451});
          batch.leaves.push({p:point(...tp,5),s:[2.1,2.7,2.1],color:[0x5a7963,0x688771,0x456c5a][Math.floor(rng()*3)]});trees++;
        }
      }
    }
  }
  const street=mesh(road,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.94,side:THREE.DoubleSide}));street.name='asphalt';group.add(street);
  for(const data of [walk,marks]){const m=mesh(data,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.92,side:THREE.DoubleSide}));m.castShadow=false;group.add(m);}
  addBatches(group,batch);group.userData={trees,lamps,vehicles};return group;
}

// A single local reflection probe, not per-building ray tracing or an optical material measurement.
export function createReflectionProbe(renderer){
  const target=new THREE.WebGLCubeRenderTarget(128,{type:THREE.HalfFloatType}),camera=new THREE.CubeCamera(.5,4500,target),pmrem=new THREE.PMREMGenerator(renderer);let filtered=null;
  return {update(scene,position,hidden=[]){
    const saved=hidden.filter(Boolean).map(o=>[o,o.visible]),environment=scene.environment,background=scene.background,visible=[];
    for(const [o] of saved)o.visible=false;
    for(const o of scene.children)if(o.userData.probeContext){visible.push([o,o.visible]);o.visible=true;}
    scene.environment=null;scene.background=null;camera.position.copy(position);camera.update(renderer,scene);
    const next=pmrem.fromCubemap(target.texture);scene.environment=next.texture;filtered?.dispose();filtered=next;
    // Restore view visibility, but retain the newly generated environment.
    for(const [o,v] of [...saved,...visible])o.visible=v;scene.background=background;
    if(!scene.environment)scene.environment=environment;
  },dispose(){filtered?.dispose();target.dispose();pmrem.dispose();}};
}
