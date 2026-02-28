import { describe, it, expect } from 'vitest';
import { AssetParam } from '../../../utils/validators.js';

describe('AssetParam validator', () => {
  it('should accept iUSD', () => {
    expect(AssetParam.parse('iUSD')).toBe('iUSD');
  });

  it('should accept iBTC', () => {
    expect(AssetParam.parse('iBTC')).toBe('iBTC');
  });

  it('should accept iETH', () => {
    expect(AssetParam.parse('iETH')).toBe('iETH');
  });

  it('should accept iSOL', () => {
    expect(AssetParam.parse('iSOL')).toBe('iSOL');
  });

  it('should reject invalid asset names', () => {
    expect(() => AssetParam.parse('invalid')).toThrow();
  });

  it('should reject empty string', () => {
    expect(() => AssetParam.parse('')).toThrow();
  });

  it('should reject lowercase variants', () => {
    expect(() => AssetParam.parse('iusd')).toThrow();
  });
});
