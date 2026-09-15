import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RobotOnlyGuard } from './robot-only.guard';

function contextWithUser(user: unknown): ExecutionContext {
  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('RobotOnlyGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    reflector.getAllAndOverride.mockReturnValue(true);
  });

  it('allows robot access tokens', () => {
    const guard = new RobotOnlyGuard(reflector as unknown as Reflector);

    const allowed = guard.canActivate(
      contextWithUser({
        type: 'robot',
        tokenUse: 'access',
        sub: 10,
        orgId: 1,
      }),
    );

    expect(allowed).toBe(true);
  });

  it('rejects robot refresh tokens on robot-only endpoints', () => {
    const guard = new RobotOnlyGuard(reflector as unknown as Reflector);

    expect(() =>
      guard.canActivate(
        contextWithUser({
          type: 'robot',
          tokenUse: 'refresh',
          sub: 10,
          orgId: 1,
        }),
      ),
    ).toThrow(ForbiddenException);
  });
});
