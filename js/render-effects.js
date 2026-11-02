import * as THREE from 'three';

// Small HDR threshold + separable bloom. Tone mapping happens only at final output.
export class LightRenderer{
  constructor(renderer){
    this.renderer=renderer;const options={type:THREE.HalfFloatType,depthBuffer:false};
    this.beauty=new THREE.WebGLRenderTarget(1,1,{...options,depthBuffer:true});this.a=new THREE.WebGLRenderTarget(1,1,options);this.b=new THREE.WebGLRenderTarget(1,1,options);
    this.scene=new THREE.Scene();this.camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
    const vertexShader='varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
    this.blur=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,uniforms:{image:{value:null},direction:{value:new THREE.Vector2()},threshold:{value:0}},vertexShader,fragmentShader:`varying vec2 vUv;uniform sampler2D image;uniform vec2 direction;uniform float threshold;
      vec3 sampleLight(vec2 uv){vec3 c=texture2D(image,uv).rgb;float l=max(max(c.r,c.g),c.b);return c*max(l-threshold,0.)/max(l,.0001);}
      void main(){vec3 c=sampleLight(vUv)*.227027;c+=(sampleLight(vUv+direction*1.384615)+sampleLight(vUv-direction*1.384615))*.316216;c+=(sampleLight(vUv+direction*3.230769)+sampleLight(vUv-direction*3.230769))*.070270;gl_FragColor=vec4(c,1.);}`});
    this.composite=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,uniforms:{image:{value:this.beauty.texture},glow:{value:this.a.texture}},vertexShader,fragmentShader:`varying vec2 vUv;uniform sampler2D image;uniform sampler2D glow;
      void main(){gl_FragColor=vec4(texture2D(image,vUv).rgb+texture2D(glow,vUv).rgb*.24,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`});
    this.quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),this.blur);this.quad.frustumCulled=false;this.scene.add(this.quad);
  }
  resize(w,h,pixelRatio){w=Math.max(1,Math.floor(w*pixelRatio));h=Math.max(1,Math.floor(h*pixelRatio));this.beauty.setSize(w,h);this.a.setSize(Math.max(1,w>>1),Math.max(1,h>>1));this.b.setSize(this.a.width,this.a.height);}
  render(scene,camera,enabled){
    const r=this.renderer;if(!enabled){r.setRenderTarget(null);r.render(scene,camera);return;}
    r.setRenderTarget(this.beauty);r.render(scene,camera);
    this.quad.material=this.blur;this.blur.uniforms.image.value=this.beauty.texture;this.blur.uniforms.threshold.value=1.15;this.blur.uniforms.direction.value.set(2/this.beauty.width,0);r.setRenderTarget(this.a);r.render(this.scene,this.camera);
    this.blur.uniforms.image.value=this.a.texture;this.blur.uniforms.threshold.value=0;this.blur.uniforms.direction.value.set(0,1/this.a.height);r.setRenderTarget(this.b);r.render(this.scene,this.camera);
    this.composite.uniforms.glow.value=this.b.texture;this.quad.material=this.composite;r.setRenderTarget(null);r.render(this.scene,this.camera);
  }
  dispose(){for(const t of [this.beauty,this.a,this.b])t.dispose();this.blur.dispose();this.composite.dispose();this.quad.geometry.dispose();}
}

export function lightBeam(a,b,color,width,opacity){
  const length=a.distanceTo(b),geometry=new THREE.PlaneGeometry(width,length),mid=a.clone().add(b).multiplyScalar(.5);
  // The plane's local Y follows the segment; vertex shader turns X toward the camera.
  const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
    uniforms:{lightColor:{value:new THREE.Color(color).multiplyScalar(8)},alpha:{value:opacity}},
    vertexShader:`varying vec2 vUv;void main(){vUv=uv;vec4 world=modelMatrix*vec4(0.,position.y,0.,1.);vec3 along=normalize(mat3(modelMatrix)*vec3(0.,1.,0.));vec3 across=cross(along,cameraPosition-world.xyz);vec3 side=across/max(length(across),.0001);world.xyz+=side*position.x;gl_Position=projectionMatrix*viewMatrix*world;}`,
    fragmentShader:`varying vec2 vUv;uniform vec3 lightColor;uniform float alpha;void main(){float edge=pow(max(0.,1.-abs(vUv.x*2.-1.)),2.);float endFade=smoothstep(0.,.015,vUv.y)*smoothstep(0.,.015,1.-vUv.y);gl_FragColor=vec4(lightColor,edge*endFade*alpha);}`});
  const beam=new THREE.Mesh(geometry,material);beam.position.copy(mid);beam.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize());return beam;
}
