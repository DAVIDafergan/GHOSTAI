import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BackupService } from './backup.service';

@Module({
  imports: [PrismaModule],
  providers: [BackupService],
  exports: [BackupService],
})
export class BackupModule {}
