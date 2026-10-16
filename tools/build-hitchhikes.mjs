import fs from 'node:fs';
const pois=JSON.parse(fs.readFileSync('public/world/pois.json'));
const meta=JSON.parse(fs.readFileSync('public/world/meta.json'));
const roads=JSON.parse(fs.readFileSync('public/world/roads.json'));
function snap(x,n){
 let best=null,dist=Infinity;
 for(const r of roads){ if(r.bridge||['path','footway','steps','track'].includes(r.kind))continue;
  for(let k=3;k<r.p.length;k+=3){const ax=r.p[k-3],an=r.p[k-2],dx=r.p[k]-ax,dn=r.p[k+1]-an,L=Math.hypot(dx,dn);if(!L)continue;
   const t=Math.max(0,Math.min(1,((x-ax)*dx+(n-an)*dn)/(L*L))),px=ax+t*dx,pn=an+t*dn,d=Math.hypot(x-px,n-pn);
   if(d<dist){dist=d;best={x:px,n:pn,dirX:dx/L,dirN:dn/L,width:r.width};}
  }
 }return best;
}
const origins=[{id:'portal',name:'Portal de VGB',...meta.start},...meta.towns,...pois.filter(p=>/balneario|barril|botella/i.test(p.name))].slice(0,10);
const routes=origins.map((o,i)=>{const a=snap(o.x,o.n);const dest=pois.filter(p=>Math.hypot(p.x-a.x,p.n-a.n)>300&&Math.hypot(p.x-a.x,p.n-a.n)<9000);const target = [700, 1500, 2500, 3500, 4500][i % 5];const d=dest.sort((p,q)=>Math.abs(Math.hypot(p.x-a.x,p.n-a.n)-target)-Math.abs(Math.hypot(q.x-a.x,q.n-a.n)-target))[0];const b=snap(d.x,d.n);return {id:`dedo-${i+1}`,name:['Luz','Ariel','Cruz','Dani','Alex','Fran','René','Sol','Paz','Sasha'][i],from:o.name,destination:d.name,x:Math.round(a.x-a.dirN*(a.width/2+1.5)),n:Math.round(a.n+a.dirX*(a.width/2+1.5)),heading:Math.atan2(a.dirN,a.dirX),destX:Math.round(b.x),destN:Math.round(b.n),distance:Math.round(Math.hypot(a.x-b.x,a.n-b.n))};});
fs.writeFileSync('src/gameplay/routes.json',JSON.stringify(routes,null,2)+'\n');

// Keep the initial server catalog aligned. After deployment, add a new SQL migration instead.
const migration = 'supabase/migrations/202610160001_progress.sql';
const sql = fs.readFileSync(migration, 'utf8');
fs.writeFileSync(migration, sql.replace(/insert into public.hitchhike_routes\(id,distance\) values[\s\S]*$/, 'insert into public.hitchhike_routes(id,distance) values\n' + routes.map(r => `('${r.id}',${r.distance})`).join(',\n') + ';\n'));
