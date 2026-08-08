import { config } from 'dotenv';

config({ path: '.env.local' });

async function main() {
  const { getWeather } = await import('@/lib/agent/weather');
  const location = process.argv.slice(2).join(' ').trim() || 'Burwell, Cambs';
  const packet = await getWeather(location, 'this_evening');
  console.log(
    JSON.stringify(
      {
        location: packet.location,
        timezone: packet.timezone,
        fetchedAt: packet.fetchedAt,
        current: packet.current,
        sun: packet.sun,
        firstHourly: packet.hourly[0],
        hourlyRows: packet.hourly.length,
        attribution: packet.attribution,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : 'Weather smoke test failed.',
  );
  process.exitCode = 1;
});
