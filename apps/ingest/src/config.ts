export function ingestApiKeyFrom(environment: NodeJS.ProcessEnv): string {
  const apiKey = environment.SPECTRO_INGEST_API_KEY;
  if (apiKey?.trim()) return apiKey;
  if (environment.NODE_ENV === 'production') {
    throw new Error('SPECTRO_INGEST_API_KEY is required in production.');
  }
  return 'sp_local_dev';
}
