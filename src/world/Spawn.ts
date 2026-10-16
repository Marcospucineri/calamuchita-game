/** Primera vez: unos 40 m antes del punto de partida, así la autoestopista del Portal se ve a lo lejos y no encima. */
export const FIRST_SPAWN_BACK = 40;

export function firstSpawn(st: { x: number; n: number; heading: number }): { x: number; n: number; heading: number } {
  return { x: st.x - Math.cos(st.heading) * FIRST_SPAWN_BACK, n: st.n - Math.sin(st.heading) * FIRST_SPAWN_BACK, heading: st.heading };
}
