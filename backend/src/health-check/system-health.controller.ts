import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { HealthCheckService } from './health-check.service';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';

/** Operator-only view of the system-wide synthetic E2E health check
 * history (Part 3 item 8) - same auth pattern and throttling rationale as
 * CompaniesController: every route here is gated by the shared operator
 * username+password, so it's an equally viable brute-force target. */
@Controller('admin/health')
@UseGuards(SuperAdminGuard)
@Throttle({ default: { limit: 30, ttl: 900_000 } })
export class SystemHealthController {
  constructor(private readonly healthCheckService: HealthCheckService) {}

  @Get('system-history')
  history(@Query('limit') limit?: string) {
    const parsed = limit ? Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500) : 100;
    return this.healthCheckService.getSystemHistory(parsed);
  }

  /** Lets an operator trigger the full E2E chain on demand instead of
   * waiting for the next hourly cron run - same rationale as the
   * per-company "run now" button in the admin console. */
  @Post('system-check/run')
  runNow() {
    return this.healthCheckService.runSystemE2ECheck();
  }
}
