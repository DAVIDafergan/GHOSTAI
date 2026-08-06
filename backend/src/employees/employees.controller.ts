import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { CurrentCompany } from '../common/decorators/current-company.decorator';
import type { Company } from '@prisma/client';

@Controller('employees')
@UseGuards(ApiKeyGuard)
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Post()
  async create(@CurrentCompany() company: Company, @Body() dto: CreateEmployeeDto) {
    const { employee, extensionKey } = await this.employeesService.create(company, dto.email, dto.name);
    return {
      id: employee.id,
      name: employee.name,
      email: employee.email,
      extensionKey,
      createdAt: employee.createdAt,
    };
  }

  @Get()
  list(@CurrentCompany() company: Company) {
    return this.employeesService.list(company.id);
  }

  @Get(':id')
  getOne(@CurrentCompany() company: Company, @Param('id') id: string) {
    return this.employeesService.getOne(company, id);
  }

  @Delete(':id')
  disable(@CurrentCompany() company: Company, @Param('id') id: string) {
    return this.employeesService.disable(company, id);
  }
}
