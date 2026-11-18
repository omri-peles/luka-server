// Numbers for the weather widget on Luka's screen (icons and digits, no sentences).
const places = new Map();
async function locate(city) {
  const name = (city || process.env.HOME_CITY || 'תל אביב').toString().trim();
  if (places.has(name)) return places.get(name);
  const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&language=he&name=' + encodeURIComponent(name));
  const g = ((await r.json()).results || [])[0];
  if (!g) return null;
  const p = { lat: g.latitude, lon: g.longitude };
  places.set(name, p);
  return p;
}
export async function weatherCard(city) {
  try {
    const p = await locate(city); if (!p) return null;
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}&current=temperature_2m,weather_code,wind_speed_10m,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=3`);
    const j = await r.json(); const c = j.current, d = j.daily;
    if (!c || !d) return null;
    return { kind: 'weather', temp: Math.round(c.temperature_2m), code: c.weather_code, day: c.is_day !== 0, wind: Math.round(c.wind_speed_10m),
      days: d.time.map((t, i) => ({ code: d.weather_code[i], max: Math.round(d.temperature_2m_max[i]), min: Math.round(d.temperature_2m_min[i]), rain: d.precipitation_probability_max ? (d.precipitation_probability_max[i] || 0) : 0 })) };
  } catch (e) { return null; }
}
