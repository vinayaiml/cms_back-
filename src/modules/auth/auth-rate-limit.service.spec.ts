import { AuthRateLimitService, AuthTooManyRequestsException } from './auth-rate-limit.service';

describe('AuthRateLimitService', () => {
  it('throttles after repeated failures in the same window', () => {
    const service = new AuthRateLimitService();
    const key = 'auth:user:key';

    for (let i = 0; i < 5; i++) {
      service.assertAllowed(key, 1000);
      service.recordFailure(key, 1000 + i);
    }

    expect(() => service.assertAllowed(key, 1100)).toThrow(AuthTooManyRequestsException);
  });

  it('resets attempts after successful login', () => {
    const service = new AuthRateLimitService();
    const key = 'auth:robot:key';

    service.recordFailure(key, 1000);
    service.recordFailure(key, 1001);
    service.recordSuccess(key);

    expect(() => service.assertAllowed(key, 1002)).not.toThrow();
  });

  it('deduplicates audit writes inside the audit window', () => {
    const service = new AuthRateLimitService();

    expect(service.shouldAudit('auth:user:key', 'INVALID_CREDENTIALS', 1000)).toBe(true);
    expect(service.shouldAudit('auth:user:key', 'INVALID_CREDENTIALS', 2000)).toBe(false);
    expect(service.shouldAudit('auth:user:key', 'INVALID_CREDENTIALS', 62_000)).toBe(true);
  });
});
