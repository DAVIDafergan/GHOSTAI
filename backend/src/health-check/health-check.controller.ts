import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import type { Company } from '@prisma/client';
import { HealthCheckService } from './health-check.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { CurrentCompany } from '../common/decorators/current-company.decorator';

@Controller('health-check')
@UseGuards(ApiKeyGuard)
export class HealthCheckController {
  constructor(private readonly healthCheckService: HealthCheckService) {}

  @Get('latest')
  latest(@CurrentCompany() company: Company) {
    return this.healthCheckService.getLatest(company.id);
  }

  /** Lets the admin console (or a curious operator) trigger a check on
   * demand instead of waiting up to an hour for the next scheduled run. */
  @Post('run')
  run(@CurrentCompany() company: Company) {
    return this.healthCheckService.runCheck(company);
  }
}
