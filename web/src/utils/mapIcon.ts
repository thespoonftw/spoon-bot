import L from "leaflet";

export const DEFAULT_PIN_COLOR = '#888fa8';

export function makeMapIcon(color: string, editing = false) {
  const c = color || DEFAULT_PIN_COLOR;
  const w = editing ? 28 : 22;
  const h = editing ? 40 : 31;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 31" width="${w}" height="${h}">
    <path d="M11 0C5.2 0 0.5 4.7 0.5 10.5c0 8 10.5 20.5 10.5 20.5s10.5-12.5 10.5-20.5C21.5 4.7 16.8 0 11 0z"
      fill="${c}" stroke="rgba(0,0,0,0.35)" stroke-width="1"/>
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
