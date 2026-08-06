import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';

// Every endpoint here is gated by the same operator username+password
// (checked before any business logic runs), so any of them is a viable
// brute-force vector, not just POST - throttle the whole controller
// strictly. IP-keyed (see CustomThrottlerGuard - x-admin-username/
// x-admin-password aren't x-api-key/x-extension-key, so this correctly
// falls back to IP), which is exactly the signal we want to limit for
// this specific attack.
//
// limit=30/15min still comfortably covers real operator usage (creating a
// handful of companies) - the existing e2e suite alone makes several calls
// to this controller in one run, which a naive low limit would break -
// while remaining overwhelmingly restrictive against brute-forcing a
// username+password pair, which is already far higher-entropy than the
// single secret this replaced.
@Controller('admin/companies')
@UseGuards(SuperAdminGuard)
@Throttle({ default: { limit: 30, ttl: 900_000 } })
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
