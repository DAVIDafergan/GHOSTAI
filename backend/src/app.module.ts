import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
