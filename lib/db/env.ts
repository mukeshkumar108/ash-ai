export function getDatabaseUrl() {
  const databaseUrl = process.env.BK_POSTGRES_URL ?? process.env.POSTGRES_URL;

  if (!databaseUrl) {
    throw new Error('BK_POSTGRES_URL or POSTGRES_URL is not defined');
  }

  return databaseUrl;
}
