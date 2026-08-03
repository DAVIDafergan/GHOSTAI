import { Module } from '@nestjs/common';
import { SessionController } from './session.controller';
import { CompaniesModule } from '../companies/companies.module';

@Module({
  imports: [CompaniesModule],
  controllers: [SessionController],
})
export class SessionModule {}
