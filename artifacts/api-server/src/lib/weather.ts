// Weather and haze tips for workers, from Open-Meteo (free, no key). Cached for 30 minutes.

type Forecast = { temp_max: number; rain_chance: number; uv_max: number; aqi: number | null; summary: string };
type Tip = { kind: "haze" | "rain" | "heat" | "sun" | "rest" | "water"; title: string; text: string };

const cache = new Map<string, { at: number; value: Forecast }>();
const TTL = 30 * 60 * 1000;
const TZ = "Asia%2FKuala_Lumpur";

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  return res.json();
}

function describe(code: number): string {
  if (code >= 95) return "Thunderstorms";
  if (code >= 80) return "Showers";
  if (code >= 61) return "Rain";
  if (code >= 51) return "Drizzle";
  if (code >= 45) return "Fog or haze";
  if (code >= 2) return "Cloudy";
  return "Mostly clear";
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

export async function forecastFor(lat: number, lon: number, day: string, today: string, startHour: number, endHour: number): Promise<Forecast> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)},${day},${startHour}-${endHour}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;

  const weather = await getJson(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=temperature_2m_max,precipitation_probability_max,uv_index_max,weather_code` +
    `&timezone=${TZ}&start_date=${day}&end_date=${day}`,
  );
  let aqi: number | null = null;
  if (daysBetween(today, day) <= 4) {
    try {
      const air = await getJson(
        `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
        `&hourly=us_aqi&timezone=${TZ}&start_date=${day}&end_date=${day}`,
      );
      const values: (number | null)[] = air.hourly?.us_aqi ?? [];
      const during = values.filter((v, h) => v != null && h >= startHour && h <= endHour) as number[];
      const all = values.filter((v) => v != null) as number[];
      const pick = during.length ? during : all;
      aqi = pick.length ? Math.max(...pick) : null;
    } catch {
      aqi = null; // Air quality is a bonus; weather tips still work without it.
    }
  }
  const d = weather.daily;
  const value: Forecast = {
    temp_max: Math.round(d.temperature_2m_max[0]),
    rain_chance: d.precipitation_probability_max[0] ?? 0,
    uv_max: Math.round(d.uv_index_max[0] ?? 0),
    aqi,
    summary: describe(d.weather_code[0] ?? 0),
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function tipsFor(f: Forecast | null, outdoor: boolean, hoursThisWeek: number, weeklyCap: number): Tip[] {
  const tips: Tip[] = [];
  if (f?.aqi != null && f.aqi > 100) {
    tips.push({
      kind: "haze", title: f.aqi > 150 ? "Unhealthy haze" : "Haze",
      text: `Air quality index ${f.aqi}. Bring an N95 mask and take indoor breaks during heavy lifting.`,
    });
  }
  if (f && f.rain_chance >= 60) {
    tips.push({
      kind: "rain", title: "Rain likely",
      text: `${f.rain_chance}% chance. Pack a raincoat, cover cables and allow extra travel time.`,
    });
  }
  if (f && f.temp_max >= 33) {
    tips.push({ kind: "heat", title: "Hot day", text: `Up to ${f.temp_max}°C. Drink water every 20 minutes and rest in the shade.` });
  }
  if (f && outdoor && f.uv_max >= 8) {
    tips.push({ kind: "sun", title: "Strong sun", text: `UV ${f.uv_max}. Wear sunscreen, a cap and long sleeves outdoors.` });
  }
  if (hoursThisWeek >= weeklyCap * 0.8) {
    tips.push({ kind: "rest", title: "Busy week", text: `${hoursThisWeek} of ${weeklyCap} hours booked. Sleep well before your next shift.` });
  }
  if (!tips.length) {
    tips.push({ kind: "water", title: "Stay hydrated", text: "Keep a water bottle at your station and stretch before loading." });
  }
  return tips;
}
