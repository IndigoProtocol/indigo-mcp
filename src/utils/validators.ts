import { z } from 'zod';

// All iAssets currently minted on Indigo. v3 added iEUR and iJPY alongside the
// original iUSD/iBTC/iETH/iSOL set.
export const AssetParam = z.enum(['iUSD', 'iBTC', 'iETH', 'iSOL', 'iEUR', 'iJPY']);
