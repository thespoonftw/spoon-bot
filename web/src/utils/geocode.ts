import { authJsonHeaders } from "./session";

export async function geocodeAndSaveLocation(id: number, name: string): Promise<[number, number] | null> {
  let lat: number | null = null;
  let lon: number | null = null;
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(name)}&format=json&limit=1`,
      { headers: { "Accept-Language": "en", "User-Agent": "spoon-bot/1.0" } }
    );
    const data = await res.json();
    if (data[0]) { lat = parseFloat(data[0].lat); lon = parseFloat(data[0].lon); }
  } catch { return null; }
  fetch(`/api/album-location/${id}/coords`, {
    method: "PUT", headers: authJsonHeaders(), body: JSON.stringify({ lat, lon }),
  });
  return lat != null && lon != null ? [lat, lon] : null;
}
