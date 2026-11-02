import { traceTwin, summarize } from './twin.js';
import { initDashboard } from './dashboard.js';
import { initPathInspector } from './path-inspector.js';
import { buildDistrict, buildStreetLife, createReflectionProbe } from './city-scene.js';
import { LightRenderer, lightBeam } from './render-effects.js';
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { solarPosition, sunVector, previewDni, localToUtc, dayOfYear, fromDayOfYear } from "./solar.js";
import {
  toThree,
  prepareTile,
  rankSubjects,
} from "./optics.js";

const $ = (id) => document.getElementById(id);
const state = {
  scenario: "adaptive",
  manualAlpha: 16,
  display: "city",
  detail: true,
  glow: true,
  beams: true,
  rayId: null,
  eventIndex: 0,
  bundle: false,
  buildingId: "",
  alpha: 24,
  month: 12,
  day: 21,
  hour: 10,
  minute: 0,
  rho: 0.3,
  mode: "reflect",
  showHop2: true,
  showIncoming: true,
};

const view = {
  tile: null,
  subjects: [],
  renderer: null,
  scene: null,
  camera: null,
  controls: null,
  sunLight: null,
  curtain: null,
  paths: null,
  markers: null,
  sunOrb: null,
  sky: null,
  hemi: null,
  city: null,
  contextObjects: [],
  roadMat: null,
  waterMat: null,
  result: null,
  hero: null,
  drawnCount: 0,
  quality: null,
  _q: null,
  lastRibbon: 0,
};

function v3(e, n, u = 0) {
  const [x, y, z] = toThree(e, n, u);
  return new THREE.Vector3(x, y, z);
}

function currentSubject() {
  return view.subjects.find((row) => row.building.id === state.buildingId) || view.subjects[0];
}

function momentSun() {
  const origin = view.tile.meta.origin;
  const utc = localToUtc(2026, state.month, state.day, state.hour, state.minute, "Asia/Hong_Kong");
  const pos = solarPosition(utc, origin.lat, origin.lon);
  return { pos, sun: sunVector(pos.elevationDeg, pos.azimuthDeg), dni: previewDni(pos.elevationDeg) };
}

function qualityProfile() {
  const narrow = window.innerWidth < 860;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const cores = navigator.hardwareConcurrency || 8;
  const low = narrow || coarse || cores <= 4;
  return {
    low,
    pixelRatio: low ? 1 : Math.min(window.devicePixelRatio || 1, 1.75),
    shadow: low ? 1024 : 2048,
    antialias: !low,
    lodNear: low ? 210 : 330,
    stepH: 12,
    stepV: 7,
  };
}

function buildingCenter(building) { return building.centroid; }
function recordedHeight(b) {return b.measured===true||(b.measured==null&&b.source==="height");}

function mountCity() {
  if (view.city) dropDraw(view.city);
  view.city = buildDistrict(view.tile, currentSubject().building, view.renderer, view.quality);
  view.city.userData.probeContext = true;
  view.city.userData.detail.visible = state.detail;
  view.scene.add(view.city);
}

function buildWater(tile) {
  const positions = [];
  for (const ring of tile.water || []) {
    if (ring.length < 3) continue;
    const contour = ring.map(([e, n]) => new THREE.Vector2(e, n));
    let faces = [];
    try {
      faces = THREE.ShapeUtils.triangulateShape(contour, []);
    } catch {
      continue;
    }
    for (const [i, j, k] of faces) {
      const pa = v3(ring[i][0], ring[i][1], 0.14);
      const pb = v3(ring[j][0], ring[j][1], 0.14);
      const pc = v3(ring[k][0], ring[k][1], 0.14);
      const normal = new THREE.Vector3().crossVectors(pb.clone().sub(pa), pc.clone().sub(pa));
      const order = normal.y >= 0 ? [pa, pb, pc] : [pa, pc, pb];
      positions.push(order[0].x, order[0].y, order[0].z, order[1].x, order[1].y, order[1].z, order[2].x, order[2].y, order[2].z);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  view.waterMat = new THREE.MeshStandardMaterial({
    color: 0x0c3e52,
    roughness: 0.32,
    metalness: 0.2,
    transparent: true,
    opacity: 0.96,
    fog: false,
  });
  view.waterGlint = {
    sunDir: new THREE.Vector3(0.15, 0.25, -0.2),
    sunColor: new THREE.Color(0xffe0b0),
    sunElev: { value: 30 },
  };
  view.waterMat.customProgramCacheKey = () => "harbour-glint-1";
  view.waterMat.onBeforeCompile = (shader) => {
    shader.uniforms.uSunDir = { value: view.waterGlint.sunDir };
    shader.uniforms.uSunColor = { value: view.waterGlint.sunColor };
    shader.uniforms.uSunElev = view.waterGlint.sunElev;
    shader.vertexShader = `varying vec3 vWaterWorld;\n${shader.vertexShader}`
      .replace(
        "#include <beginnormal_vertex>",
        `vec3 objectNormal = vec3(normal);
        float east = position.x;
        float north = -position.z;
        float rippleX = 0.08 * sin(east * 0.07 + north * 0.02);
        float rippleN = 0.08 * cos(north * 0.05 - east * 0.01);
        objectNormal = normalize(vec3(rippleX, 1.0, -rippleN));
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif`,
      )
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        vWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = `varying vec3 vWaterWorld;\nuniform vec3 uSunDir;\nuniform vec3 uSunColor;\nuniform float uSunElev;\n${shader.fragmentShader}`
      .replace(
        "#include <opaque_fragment>",
        `vec3 viewToCam = normalize(cameraPosition - vWaterWorld);
        vec3 sunL = normalize(uSunDir);
        float east = vWaterWorld.x;
        float north = -vWaterWorld.z;
        float rippleX = 0.065 * sin(east * 0.83 + north * 0.38);
        float rippleZ = 0.065 * cos(north * 0.74 - east * 0.35);
        vec3 waterN = normalize(vec3(rippleX, 1.0, rippleZ));
        vec3 halfL = normalize(sunL + viewToCam);
        float facing = max(dot(waterN, viewToCam), 0.0);
        float fres = pow(1.0 - facing, 1.55);
        float above = smoothstep(-0.4, 1.2, uSunElev);
        float low = 1.0 - smoothstep(9.0, 34.0, uSunElev);
        vec3 skyMirror = mix(vec3(0.62, 0.76, 0.84), uSunColor, low * 0.42);
        outgoingLight = mix(outgoingLight, skyMirror, fres * mix(0.16, 0.32, low));
        float spec = pow(max(dot(waterN, halfL), 0.0), mix(18.0, 56.0, clamp(uSunElev / 48.0, 0.0, 1.0)));
        float lane = 0.7 + 0.3 * sin(east * 0.04 + north * 0.08);
        float glint = spec * (0.25 + 0.75 * fres) * above * mix(0.2, 1.15, low) * lane;
        outgoingLight += uSunColor * min(glint, 1.05);
        #include <opaque_fragment>`,
      );
  };
  const mesh = new THREE.Mesh(geometry, view.waterMat);
  mesh.receiveShadow = true;
  return mesh;
}

function makeSky() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenith: { value: new THREE.Color(0x8eb4d6) },
      horizon: { value: new THREE.Color(0xd5e4ef) },
      nadir: { value: new THREE.Color(0xb7aea2) },
      sunDir: { value: new THREE.Vector3(0.2, 0.4, -0.4) },
      sunColor: { value: new THREE.Color(0xfff3d4) },
      sunElev: { value: 0.45 },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vDir = worldPos.xyz - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 zenith;
      uniform vec3 horizon;
      uniform vec3 nadir;
      uniform vec3 sunDir;
      uniform vec3 sunColor;
      uniform float sunElev;
      void main() {
        vec3 dir = normalize(vDir);
        float h = dir.y;
        vec3 col = h >= 0.0
          ? mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.38))
          : mix(horizon, nadir, pow(clamp(-h, 0.0, 1.0), 0.75));
        vec3 sun = normalize(sunDir);
        float facing = max(dot(dir, sun), 0.0);
        float disc = pow(facing, mix(900.0, 220.0, clamp(sunElev, 0.0, 1.0)));
        float glow = pow(facing, 14.0);
        float up = smoothstep(-0.02, 0.12, sunElev);
        col += sunColor * disc * 1.15 * up;
        col += sunColor * glow * 0.28 * up;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(4200, 32, 18), material);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  return sky;
}

function ribbon(positions, a, b, width) {
  const dir = new THREE.Vector3().subVectors(b, a);
  if (dir.lengthSq() < 0.16) return;
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const toCam = view.camera.position.clone().sub(mid);
  const side = new THREE.Vector3().crossVectors(dir, toCam);
  if (side.lengthSq() < 1e-6) side.crossVectors(dir, new THREE.Vector3(0, 1, 0));
  side.normalize().multiplyScalar(width * 0.5);
  const aL = a.clone().add(side);
  const aR = a.clone().sub(side);
  const bL = b.clone().add(side);
  const bR = b.clone().sub(side);
  positions.push(aL.x, aL.y, aL.z, aR.x, aR.y, aR.z, bR.x, bR.y, bR.z);
  positions.push(aL.x, aL.y, aL.z, bR.x, bR.y, bR.z, bL.x, bL.y, bL.z);
}

function applySheetFraming(){
  view.camera.aspect=$('scene-stage').clientWidth/Math.max(1,$('scene-stage').clientHeight);
  view.camera.clearViewOffset();view.camera.updateProjectionMatrix();
}

function dropDraw(obj) {
  if (!obj) return;
  view.scene.remove(obj);
  obj.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const list = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of list) {if(material.map)material.map.dispose();material.dispose();}
    }
  });
}

function selectedRootIds(){
  const ids=view.result.paths.map(p=>p.id).filter(id=>state.mode!=='street'||view.result.terminals.some(t=>t.rootId===id&&t.kind==='street'&&t.touched));
  if(!ids.includes(state.rayId)){
    state.rayId=ids.find(id=>{const ns=view.result.nodes.filter(n=>n.rootId===id);return ns.some(n=>n.role==='fin')&&ns.some(n=>n.role==='original');})||ids[0]||null;
    state.eventIndex=0;
  }
  if(!state.bundle)return [state.rayId].filter(Boolean);
  const pivot=view.result.nodes.find(n=>n.rootId===state.rayId)?.point;
  const distance=id=>{const point=view.result.nodes.find(n=>n.rootId===id)?.point;return point&&pivot?Math.hypot(...point.map((v,i)=>v-pivot[i])):Infinity;};
  const nearby=ids.filter(id=>id!==state.rayId).sort((a,b)=>distance(a)-distance(b));
  return [state.rayId,...nearby].filter(Boolean).slice(0,6);
}

function paintPaths() {
  dropDraw(view.paths);dropDraw(view.markers);
  const group=new THREE.Group(),marks=new THREE.Group();
  view.paths=group;view.markers=marks;view.scene.add(group,marks);
  if(!view.result?.segments)return;
  const ids=selectedRootIds(),colors={incident:0xc69531,reflected:0xdc6d37,transmitted:0x347fba};
  const near=state.display==='module';
  for(const segment of view.result.segments.filter(s=>ids.includes(s.rootId))){
    const a=v3(...segment.from),b=v3(...segment.to),dir=b.clone().sub(a),length=dir.length();if(length<1e-7)continue;dir.normalize();
    const stroke=[];ribbon(stroke,a,b,near?(state.bundle?.12:.035):.55);
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(stroke,3));
    group.add(new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:colors[segment.type],transparent:true,opacity:segment.rootId===state.rayId?1:.3,side:THREE.DoubleSide,depthTest:!near})));
    if(!near&&state.beams)group.add(lightBeam(a,b,colors[segment.type],2.4,segment.rootId===state.rayId?.22:.075));
    const anchor=segment.type==='incident'?b.clone().addScaledVector(dir,-(near?.8:15)):a.clone().addScaledVector(dir,Math.min(length*.4,near?1.1:12));
    const arrow=new THREE.ArrowHelper(dir,anchor,Math.min(length*.3,near?.55:7),colors[segment.type],near?.16:2,near?.09:1.2);group.add(arrow);
  }
  const nodes=view.result.nodes.filter(n=>n.rootId===state.rayId);
  state.eventIndex=Math.max(0,Math.min(state.eventIndex,nodes.length-1));
  nodes.forEach((node,i)=>{
    const marker=new THREE.Mesh(new THREE.SphereGeometry(near?.055:1.5,10,8),new THREE.MeshBasicMaterial({color:i===state.eventIndex?0x174e43:0xc8a063,depthTest:false}));
    marker.position.copy(v3(...node.point));marks.add(marker);
    if(near){
      const canvas=document.createElement('canvas');canvas.width=128;canvas.height=40;const ctx=canvas.getContext('2d');
      ctx.fillStyle='#ffffff';ctx.fillRect(0,0,128,40);ctx.fillStyle='#285444';ctx.font='28px sans-serif';ctx.textAlign='center';ctx.fillText(node.id,64,28);
      const texture=new THREE.CanvasTexture(canvas),label=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false,depthWrite:false,toneMapped:false}));label.position.copy(marker.position).add(new THREE.Vector3(.2,.2,0));label.scale.set(1.15,.38,1);label.renderOrder=100;marks.add(label);
    }
  });
  if(near&&nodes[state.eventIndex]){
    const node=nodes[state.eventIndex],from=v3(...node.point),direction=v3(...node.normal);
    marks.add(new THREE.ArrowHelper(direction,from,1.25,0x7b8c84,.14,.075));
  }
  view.drawnCount=ids.length;view.strokeCounts={};view.drawn=[];view.dirty=true;
}

function updateCurtain(){
  dropDraw(view.curtain);
  const group=new THREE.Group(),selected=new Set((view.result.nodes||[]).filter(n=>n.rootId===state.rayId).map(n=>n.surfaceId));
  const focus=view.result.nodes?.find(n=>n.rootId===state.rayId)?.point;
  for(const role of ['original','fin']){
    const positions=[],edges=[],highlight=[];
    for(const surface of view.result.surfaces||[]){
      if(surface.role!==role)continue;
      if(state.display==='module'&&!state.bundle&&role==='fin'&&focus&&Math.hypot(...surface.origin.map((v,i)=>v-focus[i]))>9)continue;
      const c=surface.corners.map(p=>v3(...p));
      for(const i of [0,1,2,0,2,3])positions.push(...c[i].toArray());
      for(let i=0;i<4;i++)edges.push(...c[i].toArray(),...c[(i+1)%4].toArray());
      if(selected.has(surface.id))for(const i of [0,1,2,0,2,3])highlight.push(...c[i].toArray());
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    group.add(new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:role==='fin'?0x9bc7b5:0xb6cdd8,transparent:true,opacity:state.display==='module'?(role==='fin'?.14:.1):.035,side:THREE.DoubleSide,depthWrite:false})));
    const edgeGeo=new THREE.BufferGeometry();edgeGeo.setAttribute('position',new THREE.Float32BufferAttribute(edges,3));group.add(new THREE.LineSegments(edgeGeo,new THREE.LineBasicMaterial({color:role==='fin'?0x86ab98:0xb3c3cb,transparent:true,opacity:.6})));
    const hi=new THREE.BufferGeometry();hi.setAttribute('position',new THREE.Float32BufferAttribute(highlight,3));group.add(new THREE.Mesh(hi,new THREE.MeshBasicMaterial({color:role==='fin'?0x82b59b:0x97bbd0,transparent:true,opacity:.2,side:THREE.DoubleSide,depthWrite:false})));
  }
  view.curtain=group;view.scene.add(group);
}

function frameActive(){
  if(!view.camera||!currentSubject())return;
  const subject=currentSubject();
  const activeIds=state.bundle?selectedRootIds():[state.rayId];
  const activeNodes=view.result?.nodes?.filter(n=>activeIds.includes(n.rootId))||[];
  const first=activeNodes[0];
  const fallback=subject.building.centroid||buildingCenter(subject.building);
  const point=first?first.point.map((_,axis)=>(Math.min(...activeNodes.map(n=>n.point[axis]))+Math.max(...activeNodes.map(n=>n.point[axis])))/2):[fallback[0],fallback[1],subject.building.height*.4];
  const span=first?Math.hypot(...point.map((_,axis)=>Math.max(...activeNodes.map(n=>n.point[axis]))-Math.min(...activeNodes.map(n=>n.point[axis])))):0;
  const localDistance=Math.max(10,span*1.35);
  const local=state.display==='module',n=subject.cluster.n,t=[-n[1],n[0]];
  view.controls.maxPolarAngle=Math.PI*.49;
  view.camera.fov=local?38:47;view.controls.minDistance=local?2:25;view.controls.maxDistance=local?500:1800;
  view.controls.target.copy(v3(...point));
  view.camera.position.copy(v3(point[0]+n[0]*(local?localDistance*.58:300)+t[0]*(local?localDistance*.82:170),point[1]+n[1]*(local?localDistance*.58:300)+t[1]*(local?localDistance*.82:170),point[2]+(local?localDistance*.25:150)));
  view.camera.updateProjectionMatrix();view.controls.update();view._q=view.camera.quaternion.clone();
  for(const obj of view.contextObjects)obj.visible=!local;
  if(view.city)view.city.visible=!local;
  if(view.sky)view.sky.visible=!local;
  if(view.sunOrb)view.sunOrb.visible=!local;
  view.scene.background=local?new THREE.Color(0xf1f5f0):null;
  if(view.streetLife)view.streetLife.visible=!local;
  $('render-controls').hidden=local;
  document.body.dataset.scene=local?'module':'city';
  view.renderer.shadowMap.needsUpdate=true;view.dirty=true;
  paintPaths();
}

function skyLook(elev) {
  if (elev <= 0.4) {
    return { zenith: 0x121a2b, horizon: 0x243044, nadir: 0x1a1816, fog: 0x1c2433, sun: 0x8899aa, hemi: 0x243044, ground: 0x3a342e, intensity: 0.08, hemiI: 0.1 };
  }
  if (elev < 8) {
    return { zenith: 0x31466e, horizon: 0xf0a06a, nadir: 0xc4a088, fog: 0xe7b48a, sun: 0xff7a3c, hemi: 0xf0c2a0, ground: 0x6a5344, intensity: 0.7, hemiI: 0.26 };
  }
  if (elev < 20) {
    return { zenith: 0x6d92c2, horizon: 0xf3d3a6, nadir: 0xcbbba6, fog: 0xe6d2b4, sun: 0xffc27a, hemi: 0xf2d2b0, ground: 0x7d6c5c, intensity: 1.35, hemiI: 0.32 };
  }
  return { zenith: 0x1a5c9c, horizon: 0xb9d0e6, nadir: 0xb7aea2, fog: 0xb7cbe0, sun: 0xfff3d4, hemi: 0xc5d7ea, ground: 0x8d8274, intensity: 1.62, hemiI: 0.32 };
}

function updateSun() {
  const { pos, sun } = momentSun();
  const subject = currentSubject();
  const focus = subject
    ? [subject.building.centroid[0], subject.building.centroid[1], subject.building.height * 0.38]
    : [0, 0, 40];
  const elev = pos.elevationDeg;
  const look = skyLook(elev);
  // A low sun throws the shadow far past the tower. Slide the shadow map
  // down-light so the street is inside it, and keep the ray direction.
  const horiz = Math.hypot(sun[0], sun[1]) || 1;
  const shift = elev < 12 ? 260 : elev < 20 ? 90 : 0;
  const cx = focus[0] - (sun[0] / horiz) * shift;
  const cy = focus[1] - (sun[1] / horiz) * shift;
  const cz = elev < 12 ? Math.max(10, focus[2] * 0.22) : focus[2];
  const place = v3(cx + sun[0] * 720, cy + sun[1] * 720, cz + Math.max(sun[2], 0.04) * 720);
  view.sunLight.position.copy(place);
  view.sunLight.target.position.copy(v3(cx, cy, cz));
  view.sunLight.target.updateMatrixWorld();
  view.sunLight.intensity = look.intensity * 1.7;
  view.sunLight.color.set(look.sun);
  if (view.hemi) {
    view.hemi.color.set(look.hemi);
    view.hemi.groundColor.set(look.ground);
    view.hemi.intensity = look.hemiI * 3.6;
  }
  view.scene.background = new THREE.Color(look.horizon);
  view.scene.fog.color.set(look.fog);
  view.scene.fog.near = elev < 10 ? 650 : 1200;
  view.scene.fog.far = elev < 10 ? 2600 : 4200;
  if (view.renderer) view.renderer.toneMappingExposure = elev < 8 ? 0.9 : elev < 20 ? 1.0 : 1.08;
  if (view.sky) {
    const uniforms = view.sky.material.uniforms;
    uniforms.zenith.value.set(look.zenith);
    uniforms.horizon.value.set(look.horizon);
    uniforms.nadir.value.set(look.nadir);
    uniforms.sunColor.value.set(look.sun);
    uniforms.sunElev.value = Math.max(0, elev) / 40;
    const [sx, sy, sz] = toThree(sun[0], sun[1], sun[2]);
    uniforms.sunDir.value.set(sx, sy, sz);
  }
  if (view.waterMat) view.waterMat.color.set(elev < 8 ? 0x1a4558 : elev < 20 ? 0x14566c : 0x0d4a60);
  if (view.waterGlint) {
    const [sx, sy, sz] = toThree(sun[0], sun[1], sun[2]);
    view.waterGlint.sunDir.set(sx, sy, sz);
    view.waterGlint.sunColor.set(look.sun);
    view.waterGlint.sunElev.value = elev;
  }
  if (view.sunOrb) {
    const orbAt = v3(focus[0] + sun[0] * 980, focus[1] + sun[1] * 980, focus[2] + Math.max(sun[2], 0.02) * 980);
    view.sunOrb.position.copy(orbAt);
    view.sunOrb.visible = elev > 0.4;
    view.sunOrb.scale.setScalar(elev < 10 ? 1.7 : 1);
    view.sunOrb.material.color.set(look.sun);
  }
  const half = elev < 12 ? 440 : elev < 20 ? 300 : 210;
  view.sunLight.shadow.bias = elev < 12 ? -0.0006 : -0.00035;
  view.sunLight.shadow.normalBias = elev < 12 ? 0.25 : 0.32;
  const shadow = view.sunLight.shadow.camera;
  shadow.left = -half;
  shadow.right = half;
  shadow.top = half;
  shadow.bottom = -half;
  shadow.near = 8;
  shadow.far = 1800;
  shadow.updateProjectionMatrix();
  view.sunLight.shadow.needsUpdate = true;
  view.renderer.shadowMap.needsUpdate = true;
  view.dirty=true;
  if(view.reflection){
    const key=[state.buildingId,state.month,state.day,state.hour,state.minute,state.detail].join('/');
    if(key!==view.probeKey){
      view.reflection.update(view.scene,v3(focus[0]+subject.cluster.n[0]*50,focus[1]+subject.cluster.n[1]*50,Math.min(90,focus[2]+25)),[view.paths,view.markers,view.curtain,view.sunOrb]);
      view.probeKey=key;view.renderer.shadowMap.needsUpdate=true;
    }
  }
}

function applyModeLook() { document.body.dataset.mode = state.mode; }

function cityCamera(kind) {
  state.display='city'; updateCurtain(); frameActive();
  const subject=currentSubject(),c=buildingCenter(subject.building);
  if(kind==='street'){
    const roads=view.tile.roads.filter(r=>['primary','secondary','tertiary','trunk'].includes(r.kind));
    const candidates=roads.flatMap(r=>r.pts.slice(1).map((b,i)=>{const a=r.pts[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]),p=[(a[0]+b[0])/2,(a[1]+b[1])/2];return {a,b,p,length,distance:Math.hypot(p[0]-c[0],p[1]-c[1])};})).filter(r=>r.length>35).sort((a,b)=>a.distance-b.distance);
    const road=candidates[0];
    if(road){const dx=(road.b[0]-road.a[0])/road.length,dy=(road.b[1]-road.a[1])/road.length;
      view.camera.position.copy(v3(road.p[0]-dx*road.length*.28,road.p[1]-dy*road.length*.28,6));
      view.controls.target.copy(v3(road.p[0]+dx*65,road.p[1]+dy*65,20));
      view.camera.fov=58;view.controls.minDistance=3;view.controls.maxPolarAngle=Math.PI*.63;
    }
  }else{
    view.controls.target.copy(v3(c[0]-30,c[1]+20,125));
    view.camera.position.copy(v3(c[0]+460,c[1]-700,450));view.camera.fov=43;
  }
  view.camera.updateProjectionMatrix();view.controls.update();view._q=view.camera.quaternion.clone();paintPaths();publishTwin();
}

function retrace(){
  if(!currentSubject())return;
  const sun=momentSun();
  view.result=traceTwin(view.tile,currentOptions());
  selectedRootIds();updateCurtain();updateSun();applyModeLook();frameActive();writeHud(sun);
  view.baseline=state.scenario==='baseline'?view.result:traceTwin(view.tile,{...currentOptions(),scenario:'baseline',alpha:0});
  publishTwin(sun);
}
function publishTwin(sun=momentSun()){
  const baseline=view.baseline||view.result;
  const detail={state:{...state},result:view.result,baseline,sun:{...sun.pos,dni:sun.dni},meta:view.tile.meta,context:{buildings:view.tile.buildings}};
  window.__twin={state:{...state},metrics:summarize(view.result),ledger:view.result.ledger};
  document.dispatchEvent(new CustomEvent('twin:update',{detail}));
}

function currentOptions() {
  const subject=currentSubject(), sun=momentSun();
  return {building:subject.building,facade:subject.cluster,alpha:state.alpha,scenario:state.scenario,sun:sun.sun,dni:sun.dni,rho:state.rho};
}

function writeHud(sun){
  const subject=currentSubject(),nodes=view.result.nodes.filter(n=>n.rootId===state.rayId),node=nodes[state.eventIndex];
  $('path-readout').textContent=node?`${state.rayId} · 交点 ${state.eventIndex+1}/${nodes.length} · ${node.role==='fin'?'外屏':'原幕墙'} ${node.surfaceId}`:'没有命中目标立面的入射采样';
  $('building-meta').textContent=`${subject.building.height.toFixed(0)} m · ${subject.building.heightNote||'来源见数据'} · 有限外屏、固定原幕墙`;
  $('alpha-val').textContent=state.alpha.toFixed(1)+'°';$('date-val').textContent=`${state.month}月${state.day}日`;
  $('time-val').textContent=`${String(state.hour).padStart(2,'0')}:${String(state.minute).padStart(2,'0')}`;
  $('rho-val').textContent=state.rho.toFixed(2);
  $('mode-street').setAttribute('aria-checked',state.mode==='street');$('mode-reflect').setAttribute('aria-checked',state.mode==='reflect');
  $('mode-hint').textContent=`${view.result.paths.length} 条入射命中目标；显示 ${view.drawnCount} 棵完整分支树。邻楼材料未知时停止，不推断镜面第二跳。`;
  $('sun-readout').textContent=`太阳高度 ${sun.pos.elevationDeg.toFixed(1)}° · 方位 ${sun.pos.azimuthDeg.toFixed(0)}° · 香港时间 / 2026`;
  $('counts').textContent=`发射 ${view.result.roots.length} · 交点 ${view.result.nodes.length} · 归一化能量残差 ${view.result.ledger.residual.toExponential(2)}`;
  $('ratio').textContent='370栋开放数据建筑；高度包含记录与推断，非现场材料或几何测量。';
}

function bind() {
  const select = $("building");
  for (const row of view.subjects) {
    const option = document.createElement("option");
    option.value = row.building.id;
    const tag = recordedHeight(row.building) ? "记录" : "推断";
    option.textContent = `${row.building.name} · ${row.building.height.toFixed(0)} m · ${tag}`;
    select.appendChild(option);
  }
  select.value = state.buildingId;
  select.addEventListener("change", () => {
    state.buildingId = select.value;
    mountCity();
    retrace();
    frameActive();
  });
  $("alpha").addEventListener("input", () => {
    state.scenario = "adaptive";
    state.alpha = Number($("alpha").value);
    state.manualAlpha = state.alpha;
    retrace();
  });
  $("doy").addEventListener("input", () => {
    const date = fromDayOfYear(Number($("doy").value));
    state.month = date.month;
    state.day = date.day;
    retrace();
  });
  $("clock").addEventListener("input", () => {
    const minutes = Number($("clock").value);
    state.hour = Math.floor(minutes / 60);
    state.minute = minutes % 60;
    retrace();
  });
  $("rho").addEventListener("input", () => {
    state.rho = Number($("rho").value);
    retrace();
  });
  $("mode-street").addEventListener("click", () => {
    state.mode = "street";
    retrace();
    frameActive();
  });
  $("mode-reflect").addEventListener("click", () => {
    state.mode = "reflect";
    retrace();
    frameActive();
  });
  $("hop2").addEventListener("change", () => {
    state.showHop2 = $("hop2").checked;
    retrace();
  });
  $("incoming").addEventListener("change", () => {
    state.showIncoming = $("incoming").checked;
    paintPaths();
  });
  $("frame").addEventListener("click", frameActive);
}

function resize() {
  const canvas = $("view");
  const width = $("scene-stage").clientWidth;
  const height = $("scene-stage").clientHeight;
  view.renderer.setPixelRatio(view.quality.pixelRatio);
  view.renderer.setSize(width, height, false);
  view.effects?.resize(width,height,view.quality.pixelRatio);
  applySheetFraming();
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  if (view.result) paintPaths();
}

async function boot() {
  const [tileRaw, presetRaw] = await Promise.all([
    fetch("./data/central.json").then((res) => res.json()),
    fetch("./data/preset.json").then((res) => (res.ok ? res.json() : null)).catch(() => null),
  ]);
  if (!tileRaw.buildings || !tileRaw.buildings.length || tileRaw.meta.counts.heightTagged < 1) {
    $("boot").textContent = "阻塞：OSM 建筑高度没有装上，页面不拿假楼代替中环。";
    return;
  }
  if (tileRaw.meta.waterSource !== "coastline") {
    $("boot").textContent = "阻塞：海岸线没有形成维多利亚港一侧的水面。";
    return;
  }
  view.tile = prepareTile(tileRaw);
  view.subjects = rankSubjects(view.tile, 10);
  if (presetRaw) {
    state.buildingId = presetRaw.buildingId;
    state.alpha = presetRaw.alpha;
    state.month = presetRaw.month;
    state.day = presetRaw.day;
    state.hour = presetRaw.hour;
    state.minute = presetRaw.minute || 0;
  }
  if (!view.subjects.some((row) => row.building.id === state.buildingId)) state.buildingId = view.subjects[0].building.id;

  view.quality = qualityProfile();
  const canvas = $("view");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: view.quality.antialias });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.type = view.quality.low ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  view.renderer = renderer;
  view.effects = new LightRenderer(renderer);
  view.scene = new THREE.Scene();
  view.scene.fog = new THREE.Fog(0xc9d7e4, 260, 1550);
  view.camera = new THREE.PerspectiveCamera(47, 1, 0.4, 9000);
  view.camera.position.set(120, 90, 160);
  view.controls = new OrbitControls(view.camera, canvas);
  view.controls.enableDamping = true;
  view.controls.addEventListener('change',()=>view.dirty=true);
  view.controls.dampingFactor = 0.08;
  view.controls.maxPolarAngle = Math.PI * 0.49;
  view.controls.minPolarAngle = 0.12;
  view.controls.minDistance = 25;
  view.controls.maxDistance = 1800;
  view.controls.zoomSpeed = 0.75;
  view.controls.rotateSpeed = 0.8;
  view.controls.touches.ONE = THREE.TOUCH.ROTATE;
  view.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;

  const bounds = view.tile.meta.bounds;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry((bounds.maxX - bounds.minX) + 80, (bounds.maxY - bounds.minY) + 40),
    new THREE.MeshStandardMaterial({ color: 0xa3aaa0, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  const midE = (bounds.minX + bounds.maxX) / 2;
  const midN = (bounds.minY + bounds.maxY) / 2;
  ground.position.copy(v3(midE, midN, 0));
  // PlaneGeometry lies in XY. After rotation.x = -90°, it lies in XZ, normal +Y. Center was placed with toThree,
  // which already sets Y to up (0) and Z to -north. rotation then keeps that translation. Good.
  ground.receiveShadow = true;
  const groundMat = ground.material;
  groundMat.color.set(0xa3aaa0);
  view.scene.add(ground);view.contextObjects.push(ground);
  view.sky = makeSky();
  view.sky.position.copy(v3(midE, midN, 0));
  view.scene.add(view.sky);
  const water=buildWater(view.tile);view.streetLife=buildStreetLife(view.tile,view.quality);
  view.scene.add(water,view.streetLife);view.contextObjects.push(water,view.streetLife);
  for(const obj of [...view.contextObjects,view.sky])obj.userData.probeContext=true;
  mountCity();

  view.sunLight = new THREE.DirectionalLight(0xfff1d6, 1.6);
  view.sunLight.castShadow = true;
  view.sunLight.shadow.mapSize.set(view.quality.shadow, view.quality.shadow);
  view.sunLight.shadow.bias = -0.00035;
  view.sunLight.shadow.normalBias = 0.32;
  view.sunLight.shadow.radius = view.quality.low ? 1.2 : 2;
  view.scene.add(view.sunLight);
  view.scene.add(view.sunLight.target);
  view.hemi = new THREE.HemisphereLight(0xd5e4ef, 0x8d8274, 0.38);
  view.scene.add(view.hemi);
  view.sunOrb = new THREE.Mesh(
    new THREE.SphereGeometry(12, 18, 12),
    new THREE.MeshBasicMaterial({ color: 0xffe3a3 }),
  );
  view.scene.add(view.sunOrb);

  const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), v3(bounds.minX + 36, bounds.minY + 28, 3), 46, 0x1c1814, 12, 7);
  view.scene.add(arrow);view.contextObjects.push(arrow);
  view.reflection=createReflectionProbe(renderer);

  $("alpha").value = String(state.alpha);
  $("doy").value = String(dayOfYear(state.month, state.day));
  $("clock").value = String(state.hour * 60 + state.minute);
  $("rho").value = String(state.rho);
  bind();
  const dashboardApi={
    update(patch) {
      if(state.scenario==='adaptive')state.manualAlpha=state.alpha;
      Object.assign(state,patch);
      if(state.scenario==='adaptive')state.alpha=patch.alpha??state.manualAlpha;
      if(state.scenario==='adaptive')state.manualAlpha=state.alpha;
      if(state.scenario==='baseline'||state.scenario==='parked')state.alpha=0;
      if(state.scenario==='fixed')state.alpha=30;
      $('alpha').value=state.alpha;
      retrace();
    },
    compare() {
      return ['baseline','parked','fixed','adaptive'].map(scenario=>{
        const angle=scenario==='baseline'||scenario==='parked'?0:scenario==='fixed'?30:state.manualAlpha;
        return {scenario,angle,metrics:summarize(traceTwin(view.tile,{...currentOptions(),scenario,alpha:angle}))};
      });
    },
    recommend:()=>null,
    selectRay(id){state.mode='reflect';state.rayId=id;state.eventIndex=0;selectedRootIds();updateCurtain();paintPaths();writeHud(momentSun());frameActive();publishTwin();},
    event(index){state.eventIndex=index;paintPaths();writeHud(momentSun());publishTwin();},
    scene(display){state.display=display;updateCurtain();frameActive();publishTwin();},
    bundle(value){state.bundle=value;updateCurtain();frameActive();writeHud(momentSun());publishTwin();},
    overview() {cityCamera('aerial');}
  };
  initDashboard(dashboardApi);
  initPathInspector(dashboardApi);
  for(const button of document.querySelectorAll('[data-camera]'))button.addEventListener('click',()=>cityCamera(button.dataset.camera));
  $('render-detail').addEventListener('change',e=>{state.detail=e.target.checked;view.city.userData.detail.visible=state.detail;view.probeKey=null;updateSun();});
  $('render-glow').checked=!view.quality.low;state.glow=!view.quality.low;
  $('render-glow').addEventListener('change',e=>{state.glow=e.target.checked;view.dirty=true;});
  $('render-beams').addEventListener('change',e=>{state.beams=e.target.checked;paintPaths();});
  function expand(value){$('scene-card').classList.toggle('expanded',value);$('expand-scene').textContent=value?'收起场景':'展开场景';$('expand-scene').setAttribute('aria-expanded',value);document.body.classList.toggle('scene-open',value);resize();}
  $('expand-scene').addEventListener('click',()=>expand(!$('scene-card').classList.contains('expanded')));
  document.addEventListener('keydown',e=>{if(e.key==='Escape')expand(false);});
  resize();
  window.addEventListener("resize", resize);
  new ResizeObserver(() => resize()).observe($("scene-stage"));
  retrace();
  cityCamera('aerial');
  $('render-status').textContent=`${view.tile.buildings.length} 栋建筑 · ${view.streetLife.userData.trees} 株示意树木 · ${view.quality.low?'轻量渲染':'PBR / HDR'}`;
  $("boot").hidden = true;

  renderer.setAnimationLoop(() => {
    view.controls.update();
    if(state.display==="city"&&view.camera.position.y<2)view.camera.position.y=2;
    const q = view.camera.quaternion;
    const moved = view._q ? Math.abs(q.dot(view._q)) < 0.9996 : false;
    const now = performance.now();
    if (moved && now - view.lastRibbon > 90) {
      view._q.copy(q);
      view.lastRibbon = now;
      paintPaths();
    }
    if(view.dirty){view.effects.render(view.scene,view.camera,state.glow&&state.display==='city');view.dirty=false;}
  });
}

boot().catch((error) => {
  console.error(error);
  $("boot").textContent = "场景加载失败。请刷新重试，或查看网络与浏览器 WebGL 支持。";
});
