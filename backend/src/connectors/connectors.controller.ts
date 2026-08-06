import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { Company } from '@prisma/client';
import { ConnectorsService } from './connectors.service';
import { CreateConnectorDto } from './dto/create-connector.dto';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { CurrentCompany } from '../common/decorators/current-company.decorator';

@Controller('connectors')
@UseGuards(ApiKeyGuard)
export class ConnectorsController {
  constructor(private readonly connectorsService: ConnectorsService) {}

  @Post()
  create(@CurrentCompany() company: Company, @Body() dto: CreateConnectorDto) {
    return this.connectorsService.create(company, dto.sourceType);
  }

  @Get()
  list(@CurrentCompany() company: Company) {
    return this.connectorsService.list(company.id);
  }

  @Post(':id/sync/start')
  start(@CurrentCompany() company: Company, @Param('id') id: string) {
    return this.connectorsService.startSync(company, id);
  }

  @Post(':id/sync/complete')
  complete(@CurrentCompany() company: Company, @Param('id') id: string) {
    return this.connectorsService.completeSync(company, id);
  }

  @Post(':id/sync/fail')
  fail(@CurrentCompany() company: Company, @Param('id') id: string) {
    return this.connectorsService.failSync(company, id);
  }

  @Delete(':id')
  delete(@CurrentCompany() company: Company, @Param('id') id: string) {
    return this.connectorsService.delete(company, id);
  }
}
