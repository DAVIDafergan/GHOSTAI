import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { AdminBootstrapGuard } from '../common/guards/admin-bootstrap.guard';

// Every endpoint here is gated by the same shared ADMIN_BOOTSTRAP_SECRET
// (checked before any business logic runs), so any of them is a viable
// brute-force vector, not just POST - throttle the whole controller
// strictly. IP-keyed (see CustomThrottlerGuard - x-admin-secret isn't
// x-api-key/x-extension-key, so this correctly falls back to IP), which is
// exactly the signal we want to limit for this specific attack.
//
// limit=30/15min still comfortably covers real operator usage (creating a
// handful of companies) - the existing e2e suite alone makes 12 calls to
// this controller in one run, which a naive low limit would break - while
// remaining overwhelmingly restrictive against brute-forcing even a weak
// secret: at 30/900s, exhausting a 9-digit numeric space (10^9, ~5x10^8
// expected attempts) would take on the order of hundreds of years.
@Controller('admin/companies')
@UseGuards(AdminBootstrapGuard)
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
