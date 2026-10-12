import { Body, Controller, ForbiddenException, Headers, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobsService } from './jobs.service';

type RunJobBody = {
  job?: 'licence-expiry' | 'license-expiry' | 'identity-retention';
};

@Controller('internal/jobs')
export class JobsController {
  constructor(
    private jobs: JobsService,
    private config: ConfigService,
  ) {}

  @Post('run')
  async run(
    @Body() body: RunJobBody,
    @Headers('jobs-trigger-secret') triggerSecret?: string,
    @Headers('x-jobs-trigger-secret') altTriggerSecret?: string,
  ) {
    const configured = this.config.get<string>('JOBS_TRIGGER_SECRET')?.trim();
    if (!configured || (triggerSecret ?? altTriggerSecret) !== configured) {
      throw new ForbiddenException('Job trigger is not authorized');
    }
    return this.jobs.runOnce(body.job ?? 'licence-expiry');
  }
}
