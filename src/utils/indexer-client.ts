import axios, { type AxiosInstance } from 'axios';

const INDEXER_URL = process.env.INDEXER_URL || 'https://analytics.indigoprotocol.io/api/v1';

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
