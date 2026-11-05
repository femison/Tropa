import { LatLng } from '../utils/geo';
import { fetchWithTimeout } from '../utils/net';

export type Condition = 'clear' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'storm';

export type Weather = {
  fetchedAt: number;
  temperature: number;
  feelsLike: number;
  windSpeed: number; // м/с
  windGusts: number; // м/с
  code: number; // WMO
  condition: Condition;
  description: string;
  emoji: string;
  /** Дождь или снег — прогулка приносит ×2 очка. */
  isBad: boolean;
  /** Шторм, гололёд, сильная жара или мороз — только короткий квест рядом. */
  isSevere: boolean;
  severeReason: string | null;
  /** Лучший час для прогулки сегодня (локальное время), если он ещё впереди. */
  bestHour: { hour: number; temperature: number; description: string } | null;
};

const CODES: Record<number, [string, string, Condition]> = {
  0: ['Ясно', '☀️', 'clear'],
  1: ['Преимущественно ясно', '🌤️', 'clear'],
  2: ['Переменная облачность', '⛅', 'cloudy'],
  3: ['Пасмурно', '☁️', 'cloudy'],
  45: ['Туман', '🌫️', 'fog'],
  48: ['Изморозь, туман', '🌫️', 'fog'],
  51: ['Лёгкая морось', '🌦️', 'rain'],
  53: ['Морось', '🌦️', 'rain'],
  55: ['Сильная морось', '🌧️', 'rain'],
  56: ['Ледяная морось', '🧊', 'rain'],
  57: ['Сильная ледяная морось', '🧊', 'rain'],
  61: ['Небольшой дождь', '🌦️', 'rain'],
  63: ['Дождь', '🌧️', 'rain'],
  65: ['Ливень', '🌧️', 'rain'],
  66: ['Ледяной дождь', '🧊', 'rain'],
  67: ['Сильный ледяной дождь', '🧊', 'rain'],
  71: ['Небольшой снег', '🌨️', 'snow'],
  73: ['Снег', '🌨️', 'snow'],
  75: ['Сильный снег', '❄️', 'snow'],
  77: ['Снежная крупа', '🌨️', 'snow'],
  80: ['Кратковременный дождь', '🌦️', 'rain'],
  81: ['Ливневый дождь', '🌧️', 'rain'],
  82: ['Сильный ливень', '⛈️', 'rain'],
  85: ['Снегопад', '🌨️', 'snow'],
  86: ['Сильный снегопад', '❄️', 'snow'],
  95: ['Гроза', '⛈️', 'storm'],
  96: ['Гроза с градом', '⛈️', 'storm'],
  99: ['Сильная гроза с градом', '⛈️', 'storm'],
};

export function describe(code: number): [string, string, Condition] {
  return CODES[code] ?? ['Неизвестно', '🌡️', 'cloudy'];
}

const ICY_CODES = new Set([56, 57, 66, 67]);

function severeReason(code: number, temp: number, feels: number, gusts: number, precip: number) {
  if (describe(code)[2] === 'storm') return 'гроза';
  if (gusts >= 17) return 'штормовой ветер';
  if (ICY_CODES.has(code) || (temp > -3 && temp < 1 && precip > 0)) return 'гололёд';
  if (feels >= 32) return 'сильная жара';
  if (feels <= -25) return 'сильный мороз';
  return null;
}

/** Оценка часа для прогулки: чем больше, тем лучше. */
function hourScore(temp: number, precipProb: number, wind: number, code: number) {
  const cond = describe(code)[2];
  let s = 100;
  s -= Math.abs(temp - 18) * 2;
  s -= precipProb * 0.6;
  s -= Math.max(0, wind - 5) * 4;
  if (cond === 'storm') s -= 80;
  if (cond === 'clear') s += 10;
  return s;
}

/** Данные любого источника, приведённые к одному виду. */
type Raw = {
  temperature: number;
  feelsLike: number;
  windSpeed: number;
  windGusts: number;
  code: number; // WMO
  precipitation: number;
  hours: { hour: number; temperature: number; precipProb: number; wind: number; code: number }[]; // только оставшиеся часы сегодня
};

function build(r: Raw): Weather {
  const [description, emoji, condition] = describe(r.code);
  const reason = severeReason(r.code, r.temperature, r.feelsLike, r.windGusts, r.precipitation);

  // Лучший час: с текущего до 22:00.
  let bestHour: Weather['bestHour'] = null;
  let bestScore = -Infinity;
  for (const h of r.hours) {
    if (h.hour < 7 || h.hour > 22) continue;
    const s = hourScore(h.temperature, h.precipProb, h.wind, h.code);
    if (s > bestScore) {
      bestScore = s;
      bestHour = { hour: h.hour, temperature: Math.round(h.temperature), description: describe(h.code)[0] };
    }
  }

  return {
    fetchedAt: Date.now(),
    temperature: Math.round(r.temperature),
    feelsLike: Math.round(r.feelsLike),
    windSpeed: r.windSpeed,
    windGusts: r.windGusts,
    code: r.code,
    condition,
    description,
    emoji,
    isBad: condition === 'rain' || condition === 'snow',
    isSevere: reason !== null,
    severeReason: reason,
    bestHour,
  };
}

async function fromOpenMeteo(p: LatLng): Promise<Raw> {
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${p.latitude.toFixed(4)}&longitude=${p.longitude.toFixed(4)}` +
    '&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m' +
    '&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m' +
    '&forecast_days=1&timezone=auto&wind_speed_unit=ms';
  const res = await fetchWithTimeout(url, {}, 6000);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const j = await res.json();
  const c = j.current;
  const nowHour = Number(String(c.time).slice(11, 13)); // время уже местное для точки
  const h = j.hourly;
  const hours: Raw['hours'] = [];
  for (let i = 0; i < h.time.length; i++) {
    const hour = Number(String(h.time[i]).slice(11, 13));
    if (hour < nowHour) continue;
    hours.push({
      hour,
      temperature: h.temperature_2m[i],
      precipProb: h.precipitation_probability[i] ?? 0,
      wind: h.wind_speed_10m[i],
      code: h.weather_code[i],
    });
  }
  return {
    temperature: c.temperature_2m,
    feelsLike: c.apparent_temperature,
    windSpeed: c.wind_speed_10m,
    windGusts: c.wind_gusts_10m,
    code: c.weather_code,
    precipitation: c.precipitation,
    hours,
  };
}

/** Символы MET Norway → коды WMO, которыми пользуется остальное приложение. */
function metSymbolToWmo(symbol: string | undefined): number {
  const s = (symbol ?? 'cloudy').replace(/_(day|night|polartwilight)$/, '');
  if (s.includes('thunder')) return 95;
  if (s === 'clearsky') return 0;
  if (s === 'fair') return 1;
  if (s === 'partlycloudy') return 2;
  if (s === 'cloudy') return 3;
  if (s === 'fog') return 45;
  if (s.includes('sleet')) return 66; // мокрый снег — считаем гололёдоопасным
  const heavy = s.startsWith('heavy');
  const light = s.startsWith('light');
  if (s.includes('snow')) return heavy ? 75 : light ? 71 : 73;
  if (s.includes('rainshowers')) return heavy ? 82 : light ? 80 : 81;
  if (s.includes('rain')) return heavy ? 65 : light ? 61 : 63;
  return 3;
}

/**
 * Запасной источник — MET Norway (api.met.no): бесплатно, без ключа.
 * Open-Meteo из части российских сетей недоступен, а met.no открывается.
 */
async function fromMetNo(p: LatLng): Promise<Raw> {
  const url =
    'https://api.met.no/weatherapi/locationforecast/2.0/complete' +
    `?lat=${p.latitude.toFixed(4)}&lon=${p.longitude.toFixed(4)}`;
  // met.no требует, чтобы приложение представлялось своим именем
  const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Tropa/0.1 (prototype walking app)' } }, 10000);
  if (!res.ok) throw new Error(`MET Norway ${res.status}`);
  const j = await res.json();
  const series: any[] = j.properties.timeseries;
  const now = Date.now();
  const today = new Date().toDateString();
  // Текущая запись — последняя, которая уже началась
  const cur = [...series].reverse().find((t) => Date.parse(t.time) <= now) ?? series[0];
  const d = cur.data.instant.details;
  const hours: Raw['hours'] = [];
  for (const t of series) {
    const at = new Date(t.time);
    if (at.getTime() < now - 3600000 || at.toDateString() !== today || !t.data.next_1_hours) continue;
    const amount = t.data.next_1_hours.details?.precipitation_amount ?? 0;
    hours.push({
      hour: at.getHours(),
      temperature: t.data.instant.details.air_temperature,
      precipProb: t.data.next_1_hours.details?.probability_of_precipitation ?? (amount > 0.1 ? 70 : 0),
      wind: t.data.instant.details.wind_speed,
      code: metSymbolToWmo(t.data.next_1_hours.summary?.symbol_code),
    });
  }
  const next = cur.data.next_1_hours ?? cur.data.next_6_hours;
  return {
    temperature: d.air_temperature,
    feelsLike: d.apparent_air_temperature ?? d.air_temperature,
    windSpeed: d.wind_speed,
    windGusts: d.wind_speed_of_gust ?? d.wind_speed * 1.5,
    code: metSymbolToWmo(next?.summary?.symbol_code),
    precipitation: next?.details?.precipitation_amount ?? 0,
    hours,
  };
}

/** Погода: сначала Open-Meteo, если он недоступен — MET Norway. */
export async function fetchWeather(p: LatLng): Promise<Weather> {
  try {
    return build(await fromOpenMeteo(p));
  } catch (e) {
    console.warn('Open-Meteo недоступен, берём MET Norway:', String((e as Error)?.message ?? e));
    return build(await fromMetNo(p));
  }
}
