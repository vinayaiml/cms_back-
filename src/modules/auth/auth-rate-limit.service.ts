import { HttpException, Injectable } from '@nestjs/common';

const WINDOW_MS = 60_000;
const BLOCK_MS = 15 * 60_000;
const MAX_FAILURES = 5;
const AUDIT_DEDUPE_MS = 60_000;

type AttemptState = {
  count: number;
  windowStartedAt: number;
  blockUntil: number;
};

export class AuthTooManyRequestsException extends HttpException {
  constructor() {
    super(
      {
        statusCode: 429,
        message: 'Too many login attempts. Try again later.',
        error: 'Too Many Requests',
      },
      429,
    );
  }
}

@Injectable()
export class AuthRateLimitService {
  private readonly attempts = new Map<string, AttemptState>();
  private readonly auditDedupe = new Map<string, number>();

  assertAllowed(key: string, now = Date.now()) {
    const state = this.attempts.get(key);
    if (!state) return;

    if (state.blockUntil > now) {
      throw new AuthTooManyRequestsException();
    }

    if (now - state.windowStartedAt > WINDOW_MS) {
      this.attempts.delete(key);
    }
  }

  recordFailure(key: string, now = Date.now()) {
    const current = this.attempts.get(key);
    const state =
      current && now - current.windowStartedAt <= WINDOW_MS
        ? current
        : { count: 0, windowStartedAt: now, blockUntil: 0 };

    state.count += 1;

    if (state.count >= MAX_FAILURES) {
      state.blockUntil = now + BLOCK_MS;
    }

    this.attempts.set(key, state);
    return state;
  }

  recordSuccess(key: string) {
    this.attempts.delete(key);
  }

  shouldAudit(key: string, reason: string, now = Date.now()) {
    const dedupeKey = `${key}:${reason}`;
    const last = this.auditDedupe.get(dedupeKey);

    if (last && now - last < AUDIT_DEDUPE_MS) {
      return false;
    }

    this.auditDedupe.set(dedupeKey, now);
    return true;
  }
}
