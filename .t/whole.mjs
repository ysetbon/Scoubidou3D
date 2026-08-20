import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { writeFileSync } from 'node:fs';
const OUT='/tmp/claude-0/-home-user-Scoubidou3D/ec338d2d-4cf9-5832-9632-c0212c36be16/scratchpad/rung';
const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox','--use-angle=swiftshader','--disable-gpu-sandbox']});
const page=await browser.newPage({viewport:{width:640,height:560}});
page.on('pageerror',(e)=>console.log('PAGEERR',e.message.slice(0,200)));
for (const key of ['box-stitch-10','ring-2x1-k1111-lh','twist-stitch-10']) {
  await page.goto(`http://localhost:5178/Scoubidou3D/app/?sample=${key}`,{waitUntil:'load'});
  await page.waitForFunction(()=>!!window.__scoubidou?.view?.laceCenterlines?.length,null,{timeout:60000});
  await page.addStyleTag({content:'#toolbar,#panel,#hover-chip,#panel-toggle,.panel-toggle,.dock{display:none!important}#scene{position:fixed;inset:0;width:100vw!important;height:100vh!important}'});
  await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
  await page.waitForTimeout(300);
  const png=await page.evaluate(async ()=>{
    const {view}=window.__scoubidou; view.setTheme('dark'); view.setParams({foldDepth:1});
    const cam=view.camera,V=cam.position.constructor;
    cam.fov=45;cam.updateProjectionMatrix();
    const pts=[]; view.scene.traverse((o)=>{ if(!o.isMesh||o.type==='GridHelper'||!o.visible)return;
      for(let q=o.parent;q;q=q.parent) if(!q.visible) return;
      const pos=o.geometry?.attributes?.position; if(!pos)return; o.updateWorldMatrix(true,false);
      for(let i=0;i<pos.count;i+=5) pts.push(new V(pos.getX(i),pos.getY(i),pos.getZ(i)).applyMatrix4(o.matrixWorld)); });
    const lo=pts[0].clone(),hi=pts[0].clone(); for(const q of pts){lo.min(q);hi.max(q);}
    const c=lo.clone().add(hi).multiplyScalar(0.5); const r=hi.distanceTo(lo)/2;
    const dist=r/Math.sin(cam.fov*Math.PI/360)/0.82;
    const a=34*Math.PI/180,e=16*Math.PI/180;
    cam.position.set(c.x+dist*Math.cos(e)*Math.sin(a),c.y-dist*Math.cos(e)*Math.cos(a),c.z+dist*Math.sin(e));
    view.controls.target.copy(c);cam.lookAt(c);view.controls.update();
    view.renderer.render(view.scene,cam);
    await new Promise(r2=>requestAnimationFrame(r2));
    view.renderer.render(view.scene,cam);
    return view.renderer.domElement.toDataURL('image/png');
  });
  writeFileSync(`${OUT}/whole-${key}.png`,Buffer.from(png.split(',')[1],'base64'));
  console.log('whole', key);
}
await browser.close();
