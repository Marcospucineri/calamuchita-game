/** Small, consistent line icons for navigation and controls. */
const paths: Record<string, string> = {
  pin: '<path d="M12 22s7-7.2 7-13a7 7 0 0 0-14 0c0 5.8 7 13 7 13Z"/><circle cx="12" cy="9" r="2.5"/>',
  map: '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Z"/><path d="M9 3v16M15 5v16"/>',
  postal: '<path d="M3 4h18v16H3z"/><path d="M3 9h18M13 9v11M6 13h4M6 16h3"/><path d="m16 13 2-1 1 3-2 1z"/>',
  options: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  controls: '<path d="M7 6h10c3 0 5 11 3 12-2 2-5-3-6-3h-4c-1 0-4 5-6 3C2 17 4 6 7 6Z"/><path d="M6 10h5M8.5 7.5v5M16 9h.01M18 12h.01"/>',
  star: '<path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  road: '<path d="M8 2c8 6-10 8-4 20h16C7 11 25 9 16 2M12 3v2m1 4-1 2m-2 4 1 3"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  brake: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M3 5a12 12 0 0 0 0 14M21 5a12 12 0 0 1 0 14M12 5v2m7 5h-2m-5 7v-2m-7-5h2"/>',
  pedal: '<path d="m10 3 8 2a2 2 0 0 1 1 3l-5 12a2 2 0 0 1-2 1l-6-2a2 2 0 0 1-1-3L8 5a2 2 0 0 1 2-2Z"/><path d="m11 7-3 9m7-8-3 9"/>',
  jump: '<path d="M12 21V3m-7 7 7-7 7 7"/>',
  camera: '<path d="M3 7h4l2-3h6l2 3h4v13H3z"/><circle cx="12" cy="13" r="4"/>',
};
export const icon = (name: string, className = ''): string => `<svg class="ui-icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.star}</svg>`;
export const googleIcon = '<svg class="google-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285f4" d="M21.6 12.2c0-.7-.1-1.5-.2-2.2H12v4.2h5.4a4.6 4.6 0 0 1-2 3v2.5h3.3c1.9-1.8 2.9-4.4 2.9-7.5Z"/><path fill="#34a853" d="M12 22c2.7 0 5-.9 6.7-2.3l-3.3-2.6c-.9.6-2 .9-3.4.9-2.6 0-4.8-1.8-5.6-4.1H3v2.6A10 10 0 0 0 12 22Z"/><path fill="#fbbc05" d="M6.4 13.9a6 6 0 0 1 0-3.8V7.5H3a10 10 0 0 0 0 9l3.4-2.6Z"/><path fill="#ea4335" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A9.6 9.6 0 0 0 12 2a10 10 0 0 0-9 5.5l3.4 2.6C7.2 7.8 9.4 6 12 6Z"/></svg>';
