import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { CompaniesModule } from './companies/companies.module';
import { EmployeesModule } from './employees/employees.module';
import { ConnectorsModule } from './connectors/connectors.module';
import { EntitiesModule } from './entities/entities.module';
import { SessionModule } from './session/session.module';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { HealthCheckModule } from './health-check/health-check.module';
import { BackupModule } from './backup/backup.module';
import { CustomThrottlerGuard } from './common/throttler/custom-throttler.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    // Generous global default (keyed by apiKey/extensionKey where present,
    // not raw IP - see CustomThrottlerGuard) - only meant to catch genuine
    // abuse, not constrain normal usage. Sensitive endpoints (company
    // creation) set a much stricter per-route limit via @Throttle().
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    PrismaModule,
    CompaniesModule,
    // SessionModule's literal `GET /employees/me` must be registered before
    // EmployeesModule's `GET /employees/:id` - Nest/Express match routes in
    // registration order, so a wildcard :id param registered first would
    // treat "me" as an id and shadow the dedicated route entirely.
    SessionModule,
    EmployeesModule,
    ConnectorsModule,
    EntitiesModule,
    AuditLogsModule,
    DashboardModule,
    HealthCheckModule,
    BackupModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: CustomThrottlerGuard },
    // Explicit, tested guarantee that no endpoint ever leaks a stack trace
    // or internal error detail to the client - see all-exceptions.filter.ts.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
