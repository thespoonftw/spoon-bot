import L from "leaflet";

export const DEFAULT_PIN_COLOR = '#888fa8';

// Each icon's SVG gradient needs an id that's unique on the page.
let gradientSeq = 0;

// A map pin in one colour, or split into equal vertical stripes when given several
// (a location shared by more than one group shows each group's colour, left to right).
export function makeMapIcon(colors: string | string[], editing = false) {
  const list = (Array.isArray(colors) ? colors : [colors]).filter(Boolean);
  if (!list.length) list.push(DEFAULT_PIN_COLOR);
  const w = editing ? 28 : 22;
  const h = editing ? 40 : 31;

  let fill = list[0];
  let defs = "";
  if (list.length > 1) {
    const id = `pin-stripes-${++gradientSeq}`;
    // Hard stops: each colour runs from its start to its end with no blending between them.
    const stops = list.flatMap((c, i) => [
      `<stop offset="${(i / list.length) * 100}%" stop-color="${c}"/>`,
      `<stop offset="${((i + 1) / list.length) * 100}%" stop-color="${c}"/>`,
    ]).join("");
    defs = `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0.5" y1="0" x2="21.5" y2="0">${stops}</linearGradient></defs>`;
    fill = `url(#${id})`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 31" width="${w}" height="${h}">${defs}
    <path d="M11 0C5.2 0 0.5 4.7 0.5 10.5c0 8 10.5 20.5 10.5 20.5s10.5-12.5 10.5-20.5C21.5 4.7 16.8 0 11 0z"
      fill="${fill}" stroke="rgba(0,0,0,0.35)" stroke-width="1"/>
    <circle cx="11" cy="10.5" r="4.5" fill="rgba(255,255,255,0.45)"/>
  </svg>`;
  return L.divIcon({
    html: svg,
    iconSize: [w, h],
    iconAnchor: [w / 2, h],
    popupAnchor: [0, -h],
    className: "",
  });
}
