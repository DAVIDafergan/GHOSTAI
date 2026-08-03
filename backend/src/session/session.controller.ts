import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import type { Company, Employee } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ExtensionKeyGuard } from '../common/guards/extension-key.guard';
import { CurrentCompany } from '../common/decorators/current-company.decorator';
import { CurrentEmployee } from '../common/decorators/current-employee.decorator';
import { CompaniesService } from '../companies/companies.service';
import { UpdateSettingsDto } from '../companies/dto/update-settings.dto';

/**
 * The Connector and Extension both need the company's entitySalt to compute
 * entityHash locally (raw values never leave the customer's network / browser).
 * These endpoints hand out that salt scoped to whichever credential authenticated.
 */
@Controller()
export class SessionController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companiesService: CompaniesService,
  ) {}

  @Get('companies/me')
  @UseGuards(ApiKeyGuard)
  company(@CurrentCompany() company: Company) {
    return {
      id: company.id,
      name: company.name,
      entitySalt: company.entitySalt,
      confidenceThreshold: company.confidenceThreshold,
      enabledEntityTypes: company.enabledEntityTypes,
    };
  }

  @Patch('companies/me')
  @UseGuards(ApiKeyGuard)
  async updateSettings(@CurrentCompany() company: Company, @Body() dto: UpdateSettingsDto) {
    const updated = await this.companiesService.updateSettings(company.id, dto);
    return {
      id: updated.id,
      name: updated.name,
      confidenceThreshold: updated.confidenceThreshold,
      enabledEntityTypes: updated.enabledEntityTypes,
    };
  }

  @Get('employees/me')
  @UseGuards(ExtensionKeyGuard)
  async employee(@CurrentEmployee() employee: Employee) {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: employee.companyId } });
    return {
      id: employee.id,
      email: employee.email,
      company: {
        id: company.id,
        entitySalt: company.entitySalt,
        confidenceThreshold: company.confidenceThreshold,
        enabledEntityTypes: company.enabledEntityTypes,
      },
    };
  }
}
