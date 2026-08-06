import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import type { Company, Employee } from '@prisma/client';
import { AuditLogsService } from './audit-logs.service';
import { CreateAuditLogDto } from './dto/create-audit-log.dto';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ExtensionKeyGuard } from '../common/guards/extension-key.guard';
import { CurrentCompany } from '../common/decorators/current-company.decorator';
import { CurrentEmployee } from '../common/decorators/current-employee.decorator';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Post()
  @UseGuards(ExtensionKeyGuard)
  create(@CurrentEmployee() employee: Employee, @Body() dto: CreateAuditLogDto) {
    return this.auditLogsService.create(employee, dto.eventType, dto.entityType, dto.platform);
  }

  @Get()
  @UseGuards(ApiKeyGuard)
  list(
    @CurrentCompany() company: Company,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('employeeId') employeeId?: string,
    @Query('entityType') entityType?: string,
  ) {
    const parsedLimit = Math.min(parseInt(limit ?? '', 10) || DEFAULT_LIMIT, MAX_LIMIT);
    return this.auditLogsService.list(company, { cursor, limit: parsedLimit, employeeId, entityType });
  }
}
