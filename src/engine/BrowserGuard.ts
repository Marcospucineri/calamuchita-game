/**
 * El juego ocupa toda la pantalla: se bloquean el zoom de la página (Ctrl/⌘ +/−, rueda con Ctrl,
 * pellizco del trackpad o de dos dedos, doble toque) y la selección de texto o el menú del toque
 * largo, que en el celu aparecían con los gestos. El mapa grande tiene su propio zoom.
 */
export function guardBrowserGestures(): void {
  const opts = { passive: false } as AddEventListenerOptions;
  // rueda con Ctrl (y el pellizco del trackpad, que llega así): nunca agranda la página
  window.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, opts);
  // atajos de zoom del navegador
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && ['+', '-', '=', '_', '0'].includes(e.key)) e.preventDefault();
  });
  // Safari (Mac e iOS): gestos de pellizco
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), opts);
  // pellizco con dos dedos sobre la página
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, opts);
  // doble toque para agrandar (fuera de botones y enlaces, que tienen que seguir andando)
  let lastTouch = 0;
  document.addEventListener('touchend', (e) => {
    const now = performance.now();
    const t = e.target as Element | null;
    if (now - lastTouch < 320 && !t?.closest('button, a, input, select, textarea')) e.preventDefault();
    lastTouch = now;
  }, opts);
  // selección de texto y menú del toque largo
  document.addEventListener('selectstart', (e) => {
    const t = e.target as Element | null;
    if (!(t instanceof Element) || !t.closest('input, textarea')) e.preventDefault();
  });
  document.addEventListener('contextmenu', (e) => {
    const t = e.target as Element | null;
    if (!(t instanceof Element) || !t.closest('a')) e.preventDefault();
  });
}
