import assert from 'node:assert/strict';
import { createServer } from 'vite';
const context = new Proxy({}, { get: (_, key) => typeof key === 'string' ? () => {} : undefined });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
const server = await createServer({ configFile:false, server:{middlewareMode:true}, appType:'custom', logLevel:'error' });
try {
  const { createAvatar } = await server.ssrLoadModule('/src/player/Character.ts');
  const { DEFAULT_PROFILE, HAIRSTYLES, HAIR_COLORS, normalizeProfile } = await server.ssrLoadModule('/src/gameplay/Progress.ts');
  for (const style of HAIRSTYLES) for (const hairColor of HAIR_COLORS) {
    const profile=normalizeProfile({name:'Prueba',appearance:{...DEFAULT_PROFILE.appearance,hair:style.id,hairColor}});
    assert.equal(profile.appearance.hair,style.id,'All hairstyles survive save normalization');
    const {mesh}=createAvatar(profile.appearance);
    let eyes=0;
    mesh.traverse((o)=>{
      if(o.material?.name==='Ojos y cejas') { eyes++; assert.equal(o.material.color.getHexString(),'171b18','Eyes and eyebrows stay black'); }
      if(o.material?.name==='Pelo y barba') assert.equal(o.material.color.getHexString(),hairColor.slice(1));
    });
    assert.equal(eyes,4,'Two eyes and two eyebrows');
    const materials=new Set();
    mesh.traverse((o)=>{if(o.isMesh){o.geometry.dispose();materials.add(o.material);}});materials.forEach(m=>m.dispose());
  }
  console.log('OK: seis peinados guardables y ojos/cejas negros con todos los colores de pelo.');
} finally { await server.close(); }
