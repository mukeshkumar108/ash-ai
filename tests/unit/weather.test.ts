import { expect, test } from '@playwright/test';

import {
  buildWeatherTool,
  clearWeatherCachesForTests,
  geocodeWeatherLocation,
  getWeather,
  WeatherLookupError,
} from '@/lib/agent/weather';

const originalFetch = globalThis.fetch;

function geocodeResponse(overrides: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      results: [
        {
          name: 'Burwell',
          admin1: 'England',
          admin2: 'Cambridgeshire',
          country: 'United Kingdom',
          latitude: 52.2763,
          longitude: 0.3273,
          timezone: 'Europe/London',
          ...overrides,
        },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function forecastResponse() {
  const times = Array.from({ length: 48 }, (_, index) => {
    const day = index < 24 ? '2026-08-08' : '2026-08-09';
    return `${day}T${String(index % 24).padStart(2, '0')}:00`;
  });
  return new Response(
    JSON.stringify({
      timezone: 'Europe/London',
      current: {
        time: '2026-08-08T13:00',
        temperature_2m: 29.2,
        apparent_temperature: 31.1,
        is_day: 1,
        precipitation: 0,
        weather_code: 1,
        cloud_cover: 18,
        wind_speed_10m: 11,
        wind_gusts_10m: 19,
      },
      hourly: {
        time: times,
        temperature_2m: times.map((_, index) => 30 - index * 0.2),
        apparent_temperature: times.map((_, index) => 31 - index * 0.2),
        precipitation_probability: times.map(() => 5),
        precipitation: times.map(() => 0),
        weather_code: times.map(() => 1),
        wind_speed_10m: times.map(() => 11),
      },
      daily: {
        time: ['2026-08-08', '2026-08-09'],
        sunrise: ['2026-08-08T05:26', '2026-08-09T05:28'],
        sunset: ['2026-08-08T20:36', '2026-08-09T20:34'],
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

test.beforeEach(() => {
  clearWeatherCachesForTests();
  process.env.WEATHER_TIMEOUT_MS = '6000';
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env.WEATHER_TIMEOUT_MS = '';
});

test('returns bounded structured weather, hourly context, and sunlight times', async () => {
  const requests: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);
    return url.includes('geocoding-api')
      ? geocodeResponse()
      : forecastResponse();
  }) as typeof fetch;

  const packet = await getWeather('Burwell, Cambridgeshire', 'this_evening');

  expect(requests).toHaveLength(2);
  expect(requests[0]).toContain('name=Burwell');
  expect(requests[1]).toContain('timezone=auto');
  expect(packet).toMatchObject({
    provider: 'Open-Meteo',
    location: 'Burwell, Cambridgeshire, England, United Kingdom',
    timezone: 'Europe/London',
    current: {
      temperatureC: 29.2,
      feelsLikeC: 31.1,
      condition: 'mainly clear',
    },
    sun: {
      date: '2026-08-08',
      sunrise: '2026-08-08T05:26',
      sunset: '2026-08-08T20:36',
    },
  });
  expect(packet.hourly[0].time).toBe('2026-08-08T17:00');
  expect(packet.hourly.length).toBeLessThanOrEqual(18);
  expect(packet.attribution).toContain('Open-Meteo.com');
});

test('tomorrow selects tomorrow hourly and sunlight data', async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) =>
    String(input).includes('geocoding-api')
      ? geocodeResponse()
      : forecastResponse()) as typeof fetch;

  const packet = await getWeather('Burwell, UK', 'tomorrow');
  expect(packet.hourly[0].time).toBe('2026-08-09T00:00');
  expect(packet.sun).toEqual({
    date: '2026-08-09',
    sunrise: '2026-08-09T05:28',
    sunset: '2026-08-09T20:34',
  });
});

test('uses the short-lived cache without repeating upstream calls', async () => {
  let calls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls += 1;
    return String(input).includes('geocoding-api')
      ? geocodeResponse()
      : forecastResponse();
  }) as typeof fetch;

  await getWeather('Burwell, UK');
  await getWeather('Burwell, UK');
  expect(calls).toBe(2);
});

test('rejects ambiguous locations rather than silently choosing one', async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        results: [
          {
            name: 'Cambridge',
            admin1: 'England',
            country: 'United Kingdom',
            latitude: 52.2,
            longitude: 0.12,
          },
          {
            name: 'Cambridge',
            admin1: 'Massachusetts',
            country: 'United States',
            latitude: 42.37,
            longitude: -71.1,
          },
        ],
      }),
      { status: 200 },
    )) as typeof fetch;

  await expect(geocodeWeatherLocation('Cambridge')).rejects.toThrow(
    'ambiguous',
  );
});

test('preserves caller cancellation and sanitizes timeout and upstream errors', async () => {
  let fetchStarted = () => {};
  const started = new Promise<void>((resolve) => {
    fetchStarted = resolve;
  });
  globalThis.fetch = ((_: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      fetchStarted();
      init?.signal?.addEventListener('abort', () =>
        reject((init.signal as AbortSignal).reason),
      );
    })) as typeof fetch;
  const controller = new AbortController();
  const request = getWeather('Burwell', 'now', { signal: controller.signal });
  await started;
  controller.abort(new DOMException('cancelled', 'AbortError'));
  await expect(request).rejects.toMatchObject({ name: 'AbortError' });

  process.env.WEATHER_TIMEOUT_MS = '5';
  await expect(getWeather('Ely', 'now')).rejects.toThrow('took too long');

  clearWeatherCachesForTests();
  globalThis.fetch = (async () =>
    new Response('secret upstream diagnostic', {
      status: 500,
    })) as typeof fetch;
  const failure = getWeather('Newmarket');
  await expect(failure).rejects.toBeInstanceOf(WeatherLookupError);
  await expect(failure).rejects.not.toThrow('secret upstream diagnostic');
});

test('model-visible tool uses saved location and records only safe outcome metadata', async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) =>
    String(input).includes('geocoding-api')
      ? geocodeResponse()
      : forecastResponse()) as typeof fetch;
  const outcomes: Array<{ location: string; ok: boolean }> = [];
  const weatherTool = buildWeatherTool({
    defaultLocation: 'Burwell, Cambridgeshire',
    onResult: (outcome) => outcomes.push(outcome),
  }) as unknown as {
    execute(
      input: { timeRange: 'today' },
      options: { toolCallId: string; messages: []; abortSignal: AbortSignal },
    ): Promise<unknown>;
  };

  const result = await weatherTool.execute(
    { timeRange: 'today' },
    {
      toolCallId: 'weather-1',
      messages: [],
      abortSignal: new AbortController().signal,
    },
  );
  expect(result).toMatchObject({ provider: 'Open-Meteo' });
  expect(outcomes).toEqual([
    {
      location: 'Burwell, Cambridgeshire, England, United Kingdom',
      ok: true,
    },
  ]);
});

test('uses region and country qualifiers to disambiguate duplicate locality names', async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        results: [
          {
            name: 'Burwell',
            admin1: 'Nebraska',
            country: 'United States',
            country_code: 'US',
            latitude: 41.78,
            longitude: -99.13,
          },
          {
            name: 'Burwell',
            admin1: 'England',
            admin2: 'Cambridgeshire',
            country: 'United Kingdom',
            country_code: 'GB',
            latitude: 52.27,
            longitude: 0.32,
          },
          {
            name: 'Burwell',
            admin1: 'England',
            admin2: 'Lincolnshire',
            country: 'United Kingdom',
            country_code: 'GB',
            latitude: 53.29,
            longitude: 0.03,
          },
        ],
      }),
      { status: 200 },
    )) as typeof fetch;

  await expect(geocodeWeatherLocation('Burwell, Cambs')).resolves.toMatchObject(
    {
      admin2: 'Cambridgeshire',
      country: 'United Kingdom',
      latitude: 52.27,
    },
  );
});

test('rejects secret-shaped location strings before contacting geocoding', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return geocodeResponse();
  }) as typeof fetch;

  for (const location of [
    'person@example.com',
    'https://example.com/private',
    'Bearer private-token',
    'Burwell\nsecret=abc',
  ]) {
    await expect(geocodeWeatherLocation(location)).rejects.toThrow(
      'location is needed',
    );
  }
  expect(calls).toBe(0);
});
