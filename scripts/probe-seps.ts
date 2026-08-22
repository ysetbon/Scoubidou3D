import { SAMPLES } from '../src/model/samples';
for (const key of Object.keys(SAMPLES)) {
  const sc: any = (SAMPLES as any)[key];
  const scene = typeof sc === 'function' ? sc() : sc;
  if (!scene || !scene.strands) { console.log(key, 'skip'); continue; }
  const byId: Record<string, any> = {};
  for (const s of scene.strands) byId[s.id] = s;
  const seps: number[] = [];
  for (const s of scene.strands) {
    const kids = scene.strands.filter((k: any) => k.parentId === s.id);
    for (const k of kids) {
      const d1 = Math.atan2(s.end.y - s.start.y, s.end.x - s.start.x);
      const d2 = Math.atan2(k.end.y - k.start.y, k.end.x - k.start.x);
      let d = d2 - d1; while (d > Math.PI) d -= 2*Math.PI; while (d < -Math.PI) d += 2*Math.PI;
      const turn = Math.abs(d)*180/Math.PI;
      if (turn >= 60) seps.push(180 - turn);
    }
  }
  seps.sort((a,b)=>a-b);
  console.log(key.padEnd(22), 'folds:', String(seps.length).padStart(3),
    'separations:', seps.length? [...new Set(seps.map(x=>x.toFixed(1)))].join(', ') : '-');
}
