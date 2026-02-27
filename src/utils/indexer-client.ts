import axios, { type AxiosInstance } from 'axios';

const INDEXER_V2_URL = process.env.INDEXER_V2_URL || 'https://indexer.indigoprotocol.io/v1';

let instance: AxiosInstance | null = null;

export function getIndexerClient(): AxiosInstance {
  if (!instance) {
    instance = axios.create({
      baseURL: INDEXER_V2_URL,
      timeout: 15_000,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });
  }
  return instance;
}

export async function getSyncStatus(): Promise<unknown> {
  const client = getIndexerClient();
  const response = await client.get('/sync/status');
  return response.data;
}
