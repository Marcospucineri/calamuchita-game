/** Music and engine share the same page lifecycle, even though they use separate contexts. */
export function bindAudioFocus(ctx: AudioContext): () => void {
  const gestures = ['pointerdown', 'keydown', 'touchend'];
  const removeUnlock = () => gestures.forEach((event) => window.removeEventListener(event, resume));
  const resume = () => {
    if (document.hidden || ctx.state === 'closed') return;
    void ctx.resume().then(() => { if (ctx.state === 'running') removeUnlock(); }).catch(() => {});
  };
  const suspend = () => { if (ctx.state !== 'closed') void ctx.suspend().catch(() => {}); };
  const visibility = () => { if (document.hidden) suspend(); else resume(); };
  gestures.forEach((event) => window.addEventListener(event, resume));
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', suspend);
  window.addEventListener('pageshow', resume);
  visibility();
  return () => {
    removeUnlock();
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('pagehide', suspend);
    window.removeEventListener('pageshow', resume);
  };
}
