import 'server-only';

import { tool } from 'ai';
import { z } from 'zod';

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const DEFAULT_TIMEOUT_MS = 6_000;
const GEOCODE_TTL_MS = 24 * 60 * 60 * 1_000;
const FORECAST_TTL_MS = 5 * 60 * 1_000;
const MAX_LOCATION_CHARS = 160;

type Fetcher = typeof fetch;
type CacheEntry<T> = { expiresAt: number; value: T };

const geocodeCache = new Map<string, CacheEntry<ResolvedLocation>>();
const forecastCache = new Map<string, CacheEntry<WeatherPacket>>();

export type WeatherTimeRange = 'now' | 'today' | 'this_evening' | 'tomorrow';

export type ResolvedLocation = {
  name: string;
  admin1?: string;
  admin2?: string;
  country: string;
  countryCode?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
};

export type WeatherPacket = {
  provider: 'Open-Meteo';
  location: string;
  latitude: number;
  longitude: number;
  timezone: string;
  fetchedAt: string;
  requestedRange: WeatherTimeRange;
  current: {
    asOf: string;
    temperatureC: number;
    feelsLikeC: number;
    condition: string;
    precipitationMm: number;
    cloudCoverPercent: number;
    windKph: number;
    windGustKph: number;
    isDay: boolean;
  };
  sun: {
    date: string;
    sunrise: string;
    sunset: string;
  };
  hourly: Array<{
    time: string;
    temperatureC: number;
    feelsLikeC: number;
    condition: string;
    precipitationProbabilityPercent: number;
    precipitationMm: number;
    windKph: number;
  }>;
  attribution: 'Weather data by Open-Meteo.com (CC BY 4.0)';
};

export class WeatherLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WeatherLookupError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizedLocation(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').slice(0, MAX_LOCATION_CHARS);
}

function normalizedPlaceToken(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('en-GB')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
  const aliases: Record<string, string> = {
    cambs: 'cambridgeshire',
    uk: 'united kingdom',
    gb: 'united kingdom',
    usa: 'united states',
    us: 'united states',
  };
  return aliases[normalized] ?? normalized;
}

function safeLocationInput(value: string): boolean {
  return (
    value.length >= 2 &&
    value.length <= MAX_LOCATION_CHARS &&
    !/[\r\n@]/u.test(value) &&
    !/\b(?:https?:\/\/|token|password|secret|authorization|bearer)\b/iu.test(
      value,
    )
  );
}

function cached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function combineSignal(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted) onAbort();
  else parent?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException('Weather lookup timed out.', 'TimeoutError'),
      ),
    timeoutMs,
  );
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onAbort);
    },
  };
}

function weatherCondition(code: number): string {
  if (code === 0) return 'clear';
  if (code === 1) return 'mainly clear';
  if (code === 2) return 'partly cloudy';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'foggy';
  if ([51, 53, 55, 56, 57].includes(code)) return 'drizzle';
  if ([61, 63, 65, 66, 67].includes(code)) return 'rain';
  if ([71, 73, 75, 77].includes(code)) return 'snow';
  if ([80, 81, 82].includes(code)) return 'rain showers';
  if ([85, 86].includes(code)) return 'snow showers';
  if ([95, 96, 99].includes(code)) return 'thunderstorms';
  return 'unknown conditions';
}

function locationLabel(location: ResolvedLocation): string {
  return [location.name, location.admin2, location.admin1, location.country]
    .filter(Boolean)
    .filter((part, index, all) => all.indexOf(part) === index)
    .join(', ');
}

async function responseJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new WeatherLookupError('Live weather is temporarily unavailable.');
  }
  try {
    return await response.json();
  } catch {
    throw new WeatherLookupError('Live weather returned an invalid response.');
  }
}

export async function geocodeWeatherLocation(
  input: string,
  { fetcher = fetch, signal }: { fetcher?: Fetcher; signal?: AbortSignal } = {},
): Promise<ResolvedLocation> {
  const location = normalizedLocation(input);
  if (!safeLocationInput(location)) {
    throw new WeatherLookupError('A location is needed to check the weather.');
  }
  const key = location.toLocaleLowerCase('en-GB');
  const cacheHit = cached(geocodeCache, key);
  if (cacheHit) return cacheHit;

  const url = new URL(GEOCODING_URL);
  const [locality, ...qualifierParts] = location
    .split(',')
    .map((part) => part.trim());
  url.searchParams.set('name', locality || location);
  url.searchParams.set('count', '5');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');

  const payload = await responseJson(
    await fetcher(url, { headers: { Accept: 'application/json' }, signal }),
  );
  const results =
    isRecord(payload) && Array.isArray(payload.results) ? payload.results : [];
  const candidates = results
    .filter(isRecord)
    .map((candidate): ResolvedLocation | null => {
      const name = stringValue(candidate.name);
      const country = stringValue(candidate.country);
      const latitude = finiteNumber(candidate.latitude);
      const longitude = finiteNumber(candidate.longitude);
      if (!name || !country || latitude === null || longitude === null) {
        return null;
      }
      return {
        name,
        country,
        latitude,
        longitude,
        admin1: stringValue(candidate.admin1) ?? undefined,
        admin2: stringValue(candidate.admin2) ?? undefined,
        countryCode: stringValue(candidate.country_code) ?? undefined,
        timezone: stringValue(candidate.timezone) ?? undefined,
      };
    })
    .filter((candidate): candidate is ResolvedLocation => candidate !== null);

  if (candidates.length === 0) {
    throw new WeatherLookupError(`I couldn't find that location.`);
  }

  const localityKey = normalizedPlaceToken(locality || location);
  const exact = candidates.filter(
    (candidate) => normalizedPlaceToken(candidate.name) === localityKey,
  );
  const qualifiers = qualifierParts
    .map(normalizedPlaceToken)
    .filter((part) => part.length > 0);
  const scored = (exact.length > 0 ? exact : candidates)
    .map((candidate) => {
      const fields = [
        candidate.admin1,
        candidate.admin2,
        candidate.country,
        candidate.countryCode,
      ]
        .filter((field): field is string => Boolean(field))
        .map(normalizedPlaceToken);
      const score = qualifiers.reduce(
        (total, qualifier) =>
          total +
          (fields.some(
            (field) =>
              field === qualifier ||
              field.includes(qualifier) ||
              qualifier.includes(field),
          )
            ? 1
            : 0),
        0,
      );
      return { candidate, score };
    })
    .sort((left, right) => right.score - left.score);
  const bestScore = scored[0]?.score ?? 0;
  const best = scored.filter(({ score }) => score === bestScore);
  if (best.length > 1 && qualifiers.length === 0) {
    const choices = exact.slice(0, 3).map(locationLabel).join('; ');
    throw new WeatherLookupError(
      `That location is ambiguous. Please choose one of: ${choices}.`,
    );
  }
  if (qualifiers.length > 0 && bestScore === 0 && scored.length > 1) {
    const choices = scored
      .slice(0, 3)
      .map(({ candidate }) => locationLabel(candidate))
      .join('; ');
    throw new WeatherLookupError(
      `That location qualifier did not match clearly. Please choose one of: ${choices}.`,
    );
  }

  const resolved = best[0]?.candidate ?? candidates[0];
  geocodeCache.set(key, {
    expiresAt: Date.now() + GEOCODE_TTL_MS,
    value: resolved,
  });
  return resolved;
}

function parseForecast(
  payload: unknown,
  location: ResolvedLocation,
  requestedRange: WeatherTimeRange,
): WeatherPacket {
  if (!isRecord(payload) || !isRecord(payload.current)) {
    throw new WeatherLookupError('Live weather returned an invalid response.');
  }
  const current = payload.current;
  const hourly = isRecord(payload.hourly) ? payload.hourly : {};
  const daily = isRecord(payload.daily) ? payload.daily : {};
  const times = Array.isArray(hourly.time) ? hourly.time : [];
  const currentTime = stringValue(current.time);
  const currentDate = currentTime?.slice(0, 10) ?? '';
  const tomorrowDate = currentDate
    ? new Date(`${currentDate}T12:00:00.000Z`)
    : null;
  tomorrowDate?.setUTCDate(tomorrowDate.getUTCDate() + 1);
  const targetDate =
    requestedRange === 'tomorrow'
      ? (tomorrowDate?.toISOString().slice(0, 10) ?? currentDate)
      : currentDate;
  const rangeFloor =
    requestedRange === 'this_evening'
      ? `${currentDate}T17:00`
      : requestedRange === 'tomorrow'
        ? `${targetDate}T00:00`
        : (currentTime ?? '');
  const startIndex = Math.max(
    0,
    times.findIndex((time) => typeof time === 'string' && time >= rangeFloor),
  );
  const numberAt = (values: unknown, index: number) =>
    Array.isArray(values) ? finiteNumber(values[index]) : null;
  const stringAt = (values: unknown, index: number) =>
    Array.isArray(values) ? stringValue(values[index]) : null;
  const requiredCurrent = {
    temperature: finiteNumber(current.temperature_2m),
    feelsLike: finiteNumber(current.apparent_temperature),
    weatherCode: finiteNumber(current.weather_code),
    precipitation: finiteNumber(current.precipitation),
    cloudCover: finiteNumber(current.cloud_cover),
    wind: finiteNumber(current.wind_speed_10m),
    gust: finiteNumber(current.wind_gusts_10m),
    isDay: finiteNumber(current.is_day),
  };
  if (
    !currentTime ||
    Object.values(requiredCurrent).some((value) => value === null)
  ) {
    throw new WeatherLookupError('Live weather returned an invalid response.');
  }

  const hourlyRows = times
    .slice(startIndex, startIndex + 18)
    .map((time, offset) => {
      const index = startIndex + offset;
      const temperature = numberAt(hourly.temperature_2m, index);
      const feelsLike = numberAt(hourly.apparent_temperature, index);
      const weatherCode = numberAt(hourly.weather_code, index);
      const precipitationProbability = numberAt(
        hourly.precipitation_probability,
        index,
      );
      const precipitation = numberAt(hourly.precipitation, index);
      const wind = numberAt(hourly.wind_speed_10m, index);
      if (
        typeof time !== 'string' ||
        temperature === null ||
        feelsLike === null ||
        weatherCode === null ||
        precipitationProbability === null ||
        precipitation === null ||
        wind === null
      ) {
        return null;
      }
      return {
        time,
        temperatureC: temperature,
        feelsLikeC: feelsLike,
        condition: weatherCondition(weatherCode),
        precipitationProbabilityPercent: precipitationProbability,
        precipitationMm: precipitation,
        windKph: wind,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
  const dailyTimes = Array.isArray(daily.time) ? daily.time : [];
  const dailyIndex = Math.max(
    0,
    dailyTimes.findIndex((value) => value === targetDate),
  );
  const sunrise = stringAt(daily.sunrise, dailyIndex);
  const sunset = stringAt(daily.sunset, dailyIndex);
  const date = stringAt(daily.time, dailyIndex);
  const timezone = stringValue(payload.timezone) ?? location.timezone ?? 'UTC';
  if (!sunrise || !sunset || !date || hourlyRows.length === 0) {
    throw new WeatherLookupError('Live weather returned an invalid response.');
  }

  return {
    provider: 'Open-Meteo',
    location: locationLabel(location),
    latitude: location.latitude,
    longitude: location.longitude,
    timezone,
    fetchedAt: new Date().toISOString(),
    requestedRange,
    current: {
      asOf: currentTime,
      temperatureC: requiredCurrent.temperature as number,
      feelsLikeC: requiredCurrent.feelsLike as number,
      condition: weatherCondition(requiredCurrent.weatherCode as number),
      precipitationMm: requiredCurrent.precipitation as number,
      cloudCoverPercent: requiredCurrent.cloudCover as number,
      windKph: requiredCurrent.wind as number,
      windGustKph: requiredCurrent.gust as number,
      isDay: requiredCurrent.isDay === 1,
    },
    sun: { date, sunrise, sunset },
    hourly: hourlyRows,
    attribution: 'Weather data by Open-Meteo.com (CC BY 4.0)',
  };
}

export async function getWeather(
  locationInput: string,
  requestedRange: WeatherTimeRange = 'today',
  {
    fetcher = fetch,
    signal: parentSignal,
  }: { fetcher?: Fetcher; signal?: AbortSignal } = {},
): Promise<WeatherPacket> {
  const bounded = combineSignal(
    parentSignal,
    positiveInteger(process.env.WEATHER_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  );
  try {
    bounded.signal.throwIfAborted();
    const location = await geocodeWeatherLocation(locationInput, {
      fetcher,
      signal: bounded.signal,
    });
    const cacheKey = `${location.latitude},${location.longitude}:${requestedRange}`;
    const cacheHit = cached(forecastCache, cacheKey);
    if (cacheHit) return cacheHit;

    const url = new URL(FORECAST_URL);
    url.searchParams.set('latitude', String(location.latitude));
    url.searchParams.set('longitude', String(location.longitude));
    url.searchParams.set('timezone', 'auto');
    url.searchParams.set(
      'forecast_days',
      requestedRange === 'tomorrow' ? '3' : '2',
    );
    url.searchParams.set(
      'current',
      'temperature_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m',
    );
    url.searchParams.set(
      'hourly',
      'temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m',
    );
    url.searchParams.set('daily', 'sunrise,sunset');

    const packet = parseForecast(
      await responseJson(
        await fetcher(url, {
          headers: { Accept: 'application/json' },
          signal: bounded.signal,
        }),
      ),
      location,
      requestedRange,
    );
    forecastCache.set(cacheKey, {
      expiresAt: Date.now() + FORECAST_TTL_MS,
      value: packet,
    });
    return packet;
  } catch (error) {
    if (parentSignal?.aborted) throw error;
    if (error instanceof WeatherLookupError) throw error;
    if (
      error instanceof DOMException &&
      (error.name === 'AbortError' || error.name === 'TimeoutError')
    ) {
      throw new WeatherLookupError('Live weather took too long to respond.');
    }
    throw new WeatherLookupError('Live weather is temporarily unavailable.');
  } finally {
    bounded.cleanup();
  }
}

export function buildWeatherTool({
  defaultLocation,
  onResult,
}: {
  defaultLocation?: string | null;
  onResult?: (result: {
    location: string;
    ok: boolean;
    error?: string;
  }) => void;
}) {
  return tool({
    description:
      "Get current and hourly weather plus today's sunrise and sunset for a public location. Use an explicit location from the conversation when present; otherwise omit location to use the user's saved default. This tool is read-only.",
    inputSchema: z.object({
      location: z
        .string()
        .trim()
        .min(2)
        .max(MAX_LOCATION_CHARS)
        .optional()
        .describe('Town, city, postcode, or public place name.'),
      timeRange: z
        .enum(['now', 'today', 'this_evening', 'tomorrow'])
        .default('today'),
    }),
    execute: async ({ location, timeRange }, { abortSignal }) => {
      const resolvedInput = normalizedLocation(
        location ?? defaultLocation ?? '',
      );
      if (!resolvedInput) {
        const error = 'I need a location before I can check the weather.';
        onResult?.({ location: '', ok: false, error });
        return { error };
      }
      try {
        const result = await getWeather(resolvedInput, timeRange, {
          signal: abortSignal,
        });
        onResult?.({ location: result.location, ok: true });
        return result;
      } catch (error) {
        if (abortSignal?.aborted) throw error;
        const message =
          error instanceof WeatherLookupError
            ? error.message
            : 'Live weather is temporarily unavailable.';
        onResult?.({ location: resolvedInput, ok: false, error: message });
        return { error: message };
      }
    },
  });
}

export function clearWeatherCachesForTests(): void {
  geocodeCache.clear();
  forecastCache.clear();
}
