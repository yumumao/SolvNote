import {describe, it, expect} from 'vitest';
import {isAccountExpired, expirationDate, assertRegistrationPolicy, isPurgeDue} from '@/lib/user-management/policy';

describe('user lifecycle policy', () => {
  const now = new Date('2026-09-27T00:00:00Z');
  it('requires a complete approved policy', () => {
    expect(() => assertRegistrationPolicy({})).toThrow('USER_POLICY_NOT_CONFIRMED');
    expect(() => assertRegistrationPolicy({defaultExpirationDays:7, inviteRequired:false, inviteMaxUses:1, inviteLifetimeDays:30, resetMode:'temporary-password-and-force-change'})).not.toThrow();
  });
  it('accepts only 7/30/permanent and calculates UTC expiry', () => {
    expect(expirationDate(7, now)?.toISOString()).toBe('2026-10-04T00:00:00.000Z');
    expect(expirationDate(30, now)?.toISOString()).toBe('2026-10-27T00:00:00.000Z');
    expect(expirationDate(null, now)).toBeNull();
    expect(() => expirationDate(365, now)).toThrow();
  });
  it('denies at the exact expiry but preserves permanent users', () => {
    expect(isAccountExpired({expiresAt:now}, now)).toBe(true);
    expect(isAccountExpired({expiresAt:null}, now)).toBe(false);
    expect(isAccountExpired({expiresAt:new Date(now.getTime()+1)}, now)).toBe(false);
  });
  it('purges only at 30 days after expiry, never permanent accounts', () => {
    const then = new Date(now.getTime() - 30*86400000);
    expect(isPurgeDue({expiresAt:then}, now)).toBe(true);
    expect(isPurgeDue({expiresAt:new Date(then.getTime()+1)}, now)).toBe(false);
    expect(isPurgeDue({expiresAt:null}, now)).toBe(false);
  });
});
