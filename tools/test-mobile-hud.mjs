import assert from 'node:assert/strict';
import { createServer } from 'vite';
const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { destinationMarker } = await server.ssrLoadModule('/src/ui/Minimap.ts');
  for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const ahead = destinationMarker(100, 200, heading, 100 + Math.cos(heading) * 1200, 200 + Math.sin(heading) * 1200, 1);
    assert.ok(Math.abs(ahead.x) < 1e-8);
    assert.equal(ahead.y, -71, 'Destination straight ahead stays at top for every heading');
    assert.equal(ahead.edge, true);
    const right = destinationMarker(100, 200, heading, 100 + Math.sin(heading) * 1200, 200 - Math.cos(heading) * 1200, 1);
    assert.ok(Math.abs(right.y) < 1e-8);
    assert.equal(right.x, 71, 'Destination on right remains right while the map rotates');
  }
  const near = destinationMarker(0, 0, 0, 60, 0, .5);
  assert.equal(near.edge, false); assert.equal(near.y, -5);
  const arrived = destinationMarker(0, 0, 1, 0, 0, 1);
  assert.ok(Number.isFinite(arrived.x) && Number.isFinite(arrived.y));

  const { HUD } = await server.ssrLoadModule('/src/ui/HUD.ts');
  const classes = new Set();
  const hud = Object.assign(Object.create(HUD.prototype), {
    toastTimers: [], root: { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) } },
    toastBox: { children: [], replaceChildren(...children) { this.children = children; } },
  });
  const first = { classList: { add() {} } }, second = { classList: { add() {} } };
  hud.showToast(first, 20);
  const obsoleteTimers = [...hud.toastTimers];
  hud.showToast(second, 2000);
  assert.deepEqual(hud.toastBox.children, [second], 'New notification replaces the old one');
  assert.ok(obsoleteTimers.every((t) => t._destroyed), 'Old removal timers cannot erase the next notification');
  assert.equal(classes.has('has-toast'), true);
  hud.clearToast();
  assert.equal(hud.toastBox.children.length, 0);
  assert.equal(classes.has('has-toast'), false, 'Location and currency return after dismissal');
  console.log('OK: destino orientado y contenido en el minimapa; un solo aviso y limpieza de temporizadores.');
} finally { await server.close(); }
