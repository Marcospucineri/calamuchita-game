/** Estilos del modo debug (se cargan solo con ?debug). */
export const DEBUG_CSS = `
.dbg {
  position: fixed; top: calc(10px + env(safe-area-inset-top, 0px)); left: 50%; transform: translateX(-50%); z-index: 40;
  max-width: calc(100vw - 24px); pointer-events: auto; background: rgba(32,24,16,0.88); color: #f6ecd6;
  border-radius: 12px; padding: 7px 10px; box-shadow: 0 6px 24px rgba(0,0,0,0.3); font: 700 12px var(--body);
  -webkit-user-select: none; user-select: none;
}
.dbg-row { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
.dbg-tag { background: #c8452c; color: #fff6e0; border-radius: 6px; padding: 3px 7px; letter-spacing: 0.08em; font-size: 11px; }
.dbg-sep { width: 1px; height: 20px; background: rgba(246,236,214,0.25); margin: 0 3px; }
.dbg button {
  border: 1px solid rgba(246,236,214,0.25); background: rgba(246,236,214,0.08); color: inherit; border-radius: 8px;
  padding: 5px 9px; font: 800 12px var(--body); cursor: pointer; min-height: 30px;
}
.dbg button:hover { background: rgba(246,236,214,0.18); }
.dbg button[aria-pressed="true"] { background: #f2c14e; color: #2d2016; border-color: #f2c14e; }
.dbg button:focus-visible, .dbg-dialog button:focus-visible, .dbg-list button:focus-visible { outline: 3px solid #f2c14e; outline-offset: 2px; }
.dbg kbd { font: 700 10px var(--body); opacity: 0.7; border: 1px solid currentColor; border-radius: 4px; padding: 0 3px; margin-left: 2px; }
.dbg-count { background: #c8452c; color: #fff; border-radius: 999px; padding: 0 6px; margin-left: 2px; }
.dbg-hint { margin-top: 5px; font-weight: 700; color: #f2d58a; }
.dbg-status { margin-top: 3px; font-weight: 600; opacity: 0.8; font-variant-numeric: tabular-nums; }
.dbg-token { display: flex; gap: 6px; margin-top: 6px; }
.dbg-token input { flex: 1; min-width: 0; border-radius: 8px; border: none; padding: 6px 9px; font: 700 13px var(--body); }
.dbg .hidden, .dbg-dialog.hidden, .dbg-list.hidden { display: none !important; }
body.debug-picking #game { cursor: crosshair; }
/* con el mapa abierto, la barra va abajo para no tapar su encabezado */
body:has(.bigmap:not(.hidden)) .dbg { top: auto; bottom: calc(10px + env(safe-area-inset-bottom, 0px)); }

.dbg-dialog { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; background: rgba(30,22,12,0.35); pointer-events: auto; }
.dbg-card {
  width: min(92vw, 480px); background: var(--paper); color: var(--ink); border-radius: 16px; padding: 16px 18px;
  box-shadow: var(--shadow); font: 600 14px var(--body);
}
.dbg-card h3 { margin: 0; font: 800 20px var(--display); }
.dbg-where { margin: 4px 0 10px; color: var(--ink-soft); font-size: 12px; }
.dbg-cats { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.dbg-cats button {
  border: 2px solid var(--c); background: transparent; color: var(--ink); border-radius: 999px; padding: 5px 11px;
  font: 800 12px var(--body); cursor: pointer;
}
.dbg-cats button[aria-checked="true"] { background: var(--c); color: #fff; }
.dbg-card textarea, .dbg-token input {
  -webkit-user-select: text; user-select: text; touch-action: auto;
}
.dbg-card textarea {
  width: 100%; box-sizing: border-box; border: 1.5px solid #d8c595; border-radius: 10px; padding: 10px; resize: vertical;
  font: 600 15px var(--body); color: var(--ink); background: #fffaf0;
}
.dbg-card textarea:focus { outline: 3px solid #f2c14e; outline-offset: 1px; }
.dbg-err { min-height: 1em; margin: 6px 0 0; color: #b0321f; font-size: 12px; }
.dbg-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.dbg-actions button { border: none; border-radius: 10px; padding: 9px 14px; font: 800 14px var(--body); cursor: pointer; background: var(--paper-2); color: var(--ink); }
.dbg-actions .dbg-save { background: var(--accent); color: #fff6e0; }
.dbg-actions button:disabled { opacity: 0.6; cursor: wait; }
.dbg-actions kbd { font: 700 10px var(--body); opacity: 0.75; margin-left: 4px; }

.dbg-list {
  position: fixed; top: 0; right: 0; bottom: 0; width: min(92vw, 360px); z-index: 50; pointer-events: auto;
  background: var(--paper); color: var(--ink); box-shadow: -8px 0 30px rgba(0,0,0,0.25); display: flex; flex-direction: column;
  font: 600 13px var(--body);
}
.dbg-list header { display: flex; align-items: center; gap: 10px; padding: 14px 14px 10px; border-bottom: 1px solid #e3d4b0; }
.dbg-list h3 { margin: 0; flex: 1; font: 800 18px var(--display); }
.dbg-list label { font-size: 12px; color: var(--ink-soft); display: flex; align-items: center; gap: 4px; }
.dbg-close { border: none; background: var(--paper-2); color: var(--ink); width: 32px; height: 32px; border-radius: 8px; font: 800 14px var(--body); cursor: pointer; }
.dbg-list ul { list-style: none; margin: 0; padding: 8px 12px 20px; overflow-y: auto; flex: 1; touch-action: pan-y; }
.dbg-list li { padding: 10px 0; border-bottom: 1px solid #ecdfc0; }
.dbg-list li.done { opacity: 0.6; }
.dbg-list li p { margin: 5px 0 7px; white-space: pre-wrap; -webkit-user-select: text; user-select: text; }
.dbg-list li .dbg-res { color: #2f6b3a; font-weight: 700; }
.dbg-list li .dbg-res.hidden { display: none; }
.dbg-li-head { display: flex; align-items: center; gap: 8px; }
.dbg-li-head small { color: var(--ink-soft); }
.dbg-chip { background: var(--c); color: #fff; border-radius: 999px; padding: 2px 8px; font: 800 11px var(--body); }
.dbg-li-actions { display: flex; flex-wrap: wrap; gap: 5px; }
.dbg-li-actions button { border: 1px solid #d8c595; background: var(--paper); color: var(--ink); border-radius: 8px; padding: 4px 8px; font: 800 12px var(--body); cursor: pointer; }
.dbg-li-actions button.danger { color: #b0321f; }
.dbg-empty { color: var(--ink-soft); }
@media (max-width: 700px) { .dbg kbd { display: none; } .dbg-status { display: none; } }
`;
