import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { AdminBootstrapGuard } from '../common/guards/admin-bootstrap.guard';

@Controller('admin/companies')
@UseGuards(AdminBootstrapGuard)
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Post()
  async create(@Body() dto: CreateCompanyDto) {
    const { company, apiKey } = await this.companiesService.create(dto.name, dto.adminEmail);
    return {
      id: company.id,
      name: company.name,
      apiKey,
      createdAt: company.createdAt,
    };
  }

  @Get()
  listAll() {
    return this.companiesService.listAllWithStats();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.companiesService.findById(id);
  }

  @Delete(':id')
  softDelete(@Param('id') id: string) {
    return this.companiesService.softDelete(id);
  }
}
