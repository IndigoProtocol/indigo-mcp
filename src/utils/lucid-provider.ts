import { Blockfrost, Lucid } from '@lucid-evolution/lucid';
import type { LucidEvolution, Network } from '@lucid-evolution/lucid';

let lucidInstance: LucidEvolution | null = null;

export function getLucidNetwork(): Network {
  const network = process.env.CARDANO_NETWORK || 'mainnet';
  switch (network.toLowerCase()) {
    case 'preprod':
      return 'Preprod';
    case 'preview':
      return 'Preview';
    default:
      return 'Mainnet';
  }
}

function getBlockfrostUrl(network: Network): string {
  switch (network) {
    case 'Preprod':
      return 'https://cardano-preprod.blockfrost.io/api/v0';
    case 'Preview':
      return 'https://cardano-preview.blockfrost.io/api/v0';
    default:
      return 'https://cardano-mainnet.blockfrost.io/api/v0';
  }
}

export async function getLucid(): Promise<LucidEvolution> {
  if (lucidInstance) return lucidInstance;

  const apiKey = process.env.BLOCKFROST_API_KEY;
  if (!apiKey) {
    throw new Error('BLOCKFROST_API_KEY environment variable is required for write operations');
  }

  const network = getLucidNetwork();
  const url = getBlockfrostUrl(network);

  lucidInstance = await Lucid(new Blockfrost(url, apiKey), network);
  return lucidInstance;
}

export function resetLucid(): void {
  lucidInstance = null;
}
