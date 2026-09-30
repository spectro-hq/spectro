export interface IngestWriteKeyGrant {
  readonly projectId: string;
  readonly environment: string;
  readonly allowedOrigins: readonly string[];
}

export interface IngestWriteKeyAuthorizer {
  authorize(key: string): Promise<IngestWriteKeyGrant | undefined>;
}
