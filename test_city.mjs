import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareTile} from './js/optics.js';

// Canvas painting is visually verified in the browser; this checks actual mesh geometry.
globalThis.document={createElement(){return {getContext(){return {fillRect(){},createLinearGradient(){return {addColorStop(){}};}};}};}};
const source=(await readFile(new URL('./js/city-scene.js',import.meta.url),'utf8')).replace("from 'three'",`from '${new URL('./vendor/three.module.js',import.meta.url).href}'`);
const {buildDistrict,buildStreetLife,inBuilding,inside,segmentDistance}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const raw=JSON.parse(await readFile(new URL('./data/central.json',import.meta.url))),tile=prepareTile(raw),focus=tile.buildings.find(b=>b.id==='way/148554945');
const original=JSON.stringify(tile.buildings),renderer={capabilities:{getMaxAnisotropy:()=>4}};
const desktop=buildDistrict(tile,focus,renderer),phone=buildDistrict(tile,focus,renderer,{low:true});
assert.equal(JSON.stringify(tile.buildings),original,'rendering must not mutate solver geometry');
assert.equal(desktop.userData.buildings,370);assert.equal(phone.userData.buildings,370);
for(let i=0;i<4;i++)assert.deepEqual(desktop.children[i].geometry.attributes.position.array,phone.children[i].geometry.attributes.position.array,'quality must preserve every footprint, hole, wall and roof');
assert(desktop.userData.ribs>phone.userData.ribs,'mobile changes ornaments only');assert(desktop.userData.roofEquipment>0);
const districtVertices=desktop.children.slice(0,3).reduce((sum,m)=>sum+m.geometry.attributes.position.count,0);
const expectedVertices=tile.buildings.reduce((sum,b)=>sum+[b.outer,...b.holes].reduce((n,r)=>n+r.filter((p,i)=>Math.hypot(p[0]-r[(i+1)%r.length][0],p[1]-r[(i+1)%r.length][1])>=.1).length*6,0),0);
assert.equal(districtVertices,expectedVertices,'no far-distance box replacement or lost footprint edges');
const hollow={outer:[[0,0],[10,0],[10,10],[0,10]],holes:[[[4,4],[6,4],[6,6],[4,6]]]};
assert(inBuilding([2,2],hollow));assert(!inBuilding([5,5],hollow));assert(!inside([12,2],hollow.outer));assert.equal(segmentDistance([3,4],[0,0],[6,0]),4);
const street=buildStreetLife(tile),streetAgain=buildStreetLife(tile);assert.deepEqual(street.userData,streetAgain.userData,'street furniture must be deterministic');
assert(street.userData.trees>50&&street.userData.lamps>50&&street.userData.vehicles>10);
for(const group of [desktop,phone,street])group.traverse(o=>{
  if(o.geometry?.attributes.position)assert([...o.geometry.attributes.position.array].every(Number.isFinite));
  if(o.isInstancedMesh){assert([...o.instanceMatrix.array].every(Number.isFinite));assert(o.count>0);}
});
console.log('city meshes ok — all 370 footprints and heights preserved on both tiers, holes, immutable solver geometry, deterministic street details, finite instance transforms');
