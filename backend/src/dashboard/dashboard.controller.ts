import { Controller, Get, UseGuards } from '@nestjs/common';
import type { Company } from '@prisma/client';
import { DashboardService } from './dashboard.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { CurrentCompany } from '../common/decorators/current-company.decorator';

@Controller('dashboard')
@UseGuards(ApiKeyGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  summary(@CurrentCompany() company: Company) {
    return this.dashboardService.getSummary(company);
  }
}
