/**
 * Postales del valle: cada punto de interés real (OSM) tiene su ilustración, una bajada corta
 * y una pista para encontrarlo. Las ilustraciones están en public/postales/<slug>.webp
 * (y <slug>-mini.webp para listas y avisos).
 */
export interface PostcardInfo {
  slug: string;
  /** Una línea en la voz de Vallecito, se muestra al abrir la postal. */
  blurb: string;
  /** Pista para encontrarla sin decir el nombre. */
  hint: string;
}

const P: Record<string, PostcardInfo> = {
  'osm-1088091778': { slug: 'capilla-inmaculada', blurb: 'Una capilla del 1700, de adobe y campanario simple. Los Reartes en estado puro.', hint: 'Una capilla muy vieja en el pueblo más antiguo del valle.' },
  'osm-1088106457': { slug: 'comuna-los-reartes', blurb: 'La casa de la comuna, con la bandera en la puerta y la calle de piedra enfrente.', hint: 'Donde se decide todo en Los Reartes.' },
  'osm-1088112311': { slug: 'morteros-aborigenes', blurb: 'Huecos en la piedra donde los comechingones molían algarroba y maíz.', hint: 'Piedras con agujeros redondos, cerca del río de Los Reartes.' },
  'osm-1088121867': { slug: 'campo-de-doma', blurb: 'Tierra, tranqueras y jinetes. Acá se doma a la vieja usanza.', hint: 'Un corral grande donde los caballos no se dejan montar fácil.' },
  'osm-1088158321': { slug: 'corral-de-piedras', blurb: 'Un corral de piedra seca que lleva más de dos siglos en pie.', hint: 'Piedras apiladas en ronda, en las afueras de Los Reartes.' },
  'osm-3779074503': { slug: 'barril-cervecero', blurb: 'El barril bajo la glorieta, en pleno centro. La foto obligada de VGB.', hint: 'Algo de madera bajo un techo en punta, en el centro de VGB.' },
  'osm-5471369058': { slug: 'mirador', blurb: 'Desde acá se ve medio valle. Ideal para parar el auto y mirar.', hint: 'Subí a las sierras al sudeste de Villa General Belgrano.' },
  'osm-5471369059': { slug: 'cerro-la-virgen', blurb: 'La Virgen cuida el pueblo desde arriba del cerro.', hint: 'Un cerro con una figura blanca en la cima, al sudeste de VGB.' },
  'osm-5471369152': { slug: 'pileta-municipal', blurb: 'Pinos, reposeras y agua fresca para las tardes de verano.', hint: 'Agua quieta y celeste entre los pinos, al sur de VGB.' },
  'osm-6768261979': { slug: 'balneario-los-reartes', blurb: 'Sauces, arena y el río tranquilo. ¿Un mate en la orilla?', hint: 'Una playa de río al costado de Los Reartes.' },
  'osm-7810809712': { slug: 'balneario-el-aguacero', blurb: 'Una olla de agua entre piedras grandes. Los valientes se tiran de arriba.', hint: 'Bajando el río, al oeste de Los Reartes.' },
  'osm-7821475842': { slug: 'capilla-fatima', blurb: 'Una capillita de piedra entre los pinos de Villa Ciudad Parque.', hint: 'Una capilla escondida en el bosque de Villa Ciudad Parque.' },
  'osm-7882386322': { slug: 'municipalidad-vgb', blurb: 'Balcones con flores y techo alpino: así es la muni de VGB.', hint: 'El edificio de las banderas, en el centro de VGB.' },
  'osm-7882386354': { slug: 'castillo-romano', blurb: 'Una torre con almenas en pleno pueblo. Nadie te va a creer.', hint: 'Una torre de piedra, cerca del centro de VGB.' },
  'osm-7882386411': { slug: 'paseo-de-los-arroyos', blurb: 'Puentecitos de madera sobre el arroyo, a la sombra de los sauces.', hint: 'Seguí el agua por dentro de Villa General Belgrano.' },
  'osm-9024234220': { slug: 'balneario-el-puente', blurb: 'El balneario junto al puente, con el río ancho y mucha arena.', hint: 'Al norte de todo, donde la ruta cruza el río.' },
  'osm-9025327801': { slug: 'balneario-vcp', blurb: 'Rocas lisas, agua clara y pinos alrededor. Siesta asegurada.', hint: 'El río, del lado oeste de Villa Ciudad Parque.' },
  'osm-9452889568': { slug: 'museo-el-tacu', blurb: 'Carruajes y diligencias de otra época, bajo la sombra de un algarrobo enorme.', hint: 'Un museo de ruedas grandes, al norte de Villa Ciudad Parque.' },
  'osm-9868441143': { slug: 'amo-cordoba', blurb: 'Las letras para la foto. Sonreí.', hint: 'Letras gigantes de colores en Villa General Belgrano.' },
  'osm-10210432719': { slug: 'union-de-los-rios', blurb: 'Dos ríos se juntan y siguen como uno. Hay una ermita en la orilla.', hint: 'Donde dos ríos se encuentran, en el extremo norte del valle.' },
  'osm-10210473118': { slug: 'plaza-enrique-dick', blurb: 'Una plaza chiquita, con bancos y una gruta bajo los árboles.', hint: 'Una plaza tranquila en Villa General Belgrano.' },
  'osm-10210473617': { slug: 'dei-lavender', blurb: 'Hileras de lavanda y abejas por todos lados. Bajá la ventanilla.', hint: 'Un campo violeta entre Villa General Belgrano y Villa Ciudad Parque.' },
  'osm-11077987360': { slug: 'totem-oktoberfest', blurb: 'El tótem tallado de la Fiesta Nacional de la Cerveza.', hint: 'Una figura de madera tallada, al lado del barril.' },
  'osm-13581370202': { slug: 'museo-historico-vgb', blurb: 'La historia de los pioneros de Villa General Belgrano.', hint: 'Una casona alpina con historia, en VGB.' },
  'osm-13704587318': { slug: 'cerro-aleman', blurb: 'Un pico de granito con vista larga. Llevá agua.', hint: 'Un cerro de piedra en las sierras, pasando el Cerro La Virgen.' },
  'osm-13781786401': { slug: 'museo-historico-vgb', blurb: 'El museo y centro cultural del pueblo, con los recuerdos de los primeros colonos.', hint: 'Otra entrada al museo histórico de VGB.' },
};

const FALLBACK: PostcardInfo = { slug: 'mirador', blurb: 'Un lugar del valle que vale la pena conocer.', hint: 'Recorré el valle para encontrarla.' };

export function postcardFor(poiId: string): PostcardInfo {
  return P[poiId] ?? FALLBACK;
}

const base = () => (import.meta.env?.BASE_URL ?? './');
export const postcardImage = (poiId: string, mini = false) => `${base()}postales/${postcardFor(poiId).slug}${mini ? '-mini' : ''}.webp`;
