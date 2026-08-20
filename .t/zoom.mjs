import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { writeFileSync } from 'node:fs';
const OUT='/tmp/claude-0/-home-user-Scoubidou3D/ec338d2d-4cf9-5832-9632-c0212c36be16/scratchpad/rung';
const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox','--use-angle=swiftshader','--disable-gpu-sandbox']});
const page=await browser.newPage({viewport:{width:640,height:520}});
page.on('pageerror',(e)=>console.log('PAGEERR',e.message.slice(0,200)));
await page.goto('http://localhost:5178/Scoubidou3D/app/?sample=box-stitch',{waitUntil:'load'});
await page.waitForFunction(()=>!!window.__scoubidou?.view?.laceCenterlines?.length,null,{timeout:60000});
await page.addStyleTag({content:'#toolbar,#panel,#hover-chip,#panel-toggle,.panel-toggle,.dock{display:none!important}#scene{position:fixed;inset:0;width:100vw!important;height:100vh!important}'});
await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
await page.waitForTimeout(300);
const info = await page.evaluate(()=>{
  const {view}=window.__scoubidou; view.setTheme('dark');
  view.setParams({foldDepth:1});
  const FOLD=Math.PI/3;
  const turnAt=(p,i)=>{const ax=p[i].x-p[i-1].x,ay=p[i].y-p[i-1].y,bx=p[i+1].x-p[i].x,by=p[i+1].y-p[i].y;
    const la=Math.hypot(ax,ay),lb=Math.hypot(bx,by); if(la<1e-9||lb<1e-9)return 0;
    return Math.acos(Math.max(-1,Math.min(1,(ax*bx+ay*by)/(la*lb))));};
  const L=view.laceCenterlines[0],P=L.line,folds=[];
  for(let i=1;i<P.length-1;i++) if(turnAt(P,i)>=FOLD) folds.push(i);
  const fi=folds[folds.length>>1];
  const p=P[fi];
  window.__target={x:p.x,y:p.y,z:p.z,w:L.width};
  return { turnDeg:(turnAt(P,fi)*180/Math.PI).toFixed(1), zIn:p.zIn, zOut:p.zOut, z:p.z };
});
console.log('framed fold:', JSON.stringify(info));
for (const [az,el,span] of [[160,4,2.2],[135,4,2.2],[185,4,2.2],[160,30,2.2]]) {
  const png=await page.evaluate(async ({az,el,span})=>{
    const {view}=window.__scoubidou;const t=window.__target;
    const cam=view.camera,V=cam.position.constructor;
    cam.fov=45;cam.updateProjectionMatrix();
    const c=new V(t.x,t.y,t.z);
    const dist=(t.w*span)/(2*Math.tan(22.5*Math.PI/180));
    const ar=az*Math.PI/180,er=el*Math.PI/180;
    cam.position.set(c.x+dist*Math.cos(er)*Math.sin(ar),c.y-dist*Math.cos(er)*Math.cos(ar),c.z+dist*Math.sin(er));
    view.controls.target.copy(c);cam.lookAt(c);view.controls.update();
    view.renderer.render(view.scene,cam);
    await new Promise(r=>requestAnimationFrame(r));
    view.renderer.render(view.scene,cam);
    return view.renderer.domElement.toDataURL('image/png');
  },{az,el,span});
  writeFileSync(`${OUT}/zoom-${az}-${el}.png`,Buffer.from(png.split(',')[1],'base64'));
}
console.log('zoomed shots done');
await browser.close();
