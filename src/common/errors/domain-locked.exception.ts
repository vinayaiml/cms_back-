import { HttpException } from '@nestjs/common';

export class DomainLockedException extends HttpException {
  constructor(code: string, message: string) {
    super(
      {
        error: {
          code,
          message,
          locked: true,
        },
      },
      423,
    );
  }
}
