import { Controller, Get, Post, Query, UseGuards, Body } from '@nestjs/common';
import type { Company, Employee } from '@prisma/client';
import { EntitiesService } from './entities.service';
import { IngestEntitiesDto } from './dto/ingest-entities.dto';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ExtensionKeyGuard } from '../common/guards/extension-key.guard';
import { CurrentCompany } from '../common/decorators/current-company.decorator';
import { CurrentEmployee } from '../common/decorators/current-employee.decorator';

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

@Controller('entities')
export class EntitiesController {
  constructor(private readonly entitiesService: EntitiesService) {}

  @Post('batch')
  @UseGuards(ApiKeyGuard)
  ingest(@CurrentCompany() company: Company, @Body() dto: IngestEntitiesDto) {
    return this.entitiesService.ingestBatch(company, dto);
  }

  @Get()
  @UseGuards(ExtensionKeyGuard)
  list(
    @CurrentEmployee() employee: Employee,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = Math.min(parseInt(limit ?? '', 10) || DEFAULT_LIMIT, MAX_LIMIT);
    return this.entitiesService.list(employee.companyId, cursor, parsedLimit);
  }
}
