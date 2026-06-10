import axios, { type AxiosInstance } from 'axios';

// Indigo v3 moved the analytics indexer from /api/v1 to /api. Override with the
// INDEXER_URL env var if pointing at a different deployment.
const INDEXER_URL = process.env.INDEXER_URL || 'https://analytics.indigoprotocol.io/api';

let instance: AxiosInstance | null = null;

export function getIndexerClient(): AxiosInstance {
  if (!instance) {
    instance = axios.create({
      baseURL: INDEXER_URL,
      timeout: 15_000,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });
  }
  return instance;
}

export async function getLiquidations(): Promise<unknown> {
  const client = getIndexerClient();
  const response = await client.get('/liquidations');
  return response.data;
}
