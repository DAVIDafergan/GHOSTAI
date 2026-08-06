import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { mkdir, readdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_RETENTION_DAYS = 14;
const BACKUP_FILE_PREFIX = 'backup-';
const BACKUP_FILE_SUFFIX = '.json';

/**
 * Railway's native automated volume backups require a paid plan (this
 * project runs on Hobby) - `volumeInstanceBackupScheduleUpdate` returns
 * "Not Authorized" for this account. Rather than silently going without any
 * backup, or unilaterally upgrading the plan (a real-money decision that
 * isn't this task's call to make), this is a self-contained daily logical
 * backup: every row of every table, as JSON, written to a dedicated backup
 * volume. Deliberately row-level/app-level rather than a binary pg_dump -
 * simpler to implement without relying on a `pg_dump` binary being present
 * in the Nixpacks build image (unverified without a deploy, which is out of
 * scope until final approval), and "daily is sufficient at this stage" per
 * the task that asked for this. See BUILD_LOG.md for the full reasoning.
 *
 * Every table backed up here only ever contains `entityHash` values
 * (HMAC-SHA256 of the real value), never raw PII, and only *hashes* of
 * apiKey/extensionKey secrets - consistent with the project's core
 * invariant that the central backend never sees raw customer data.
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(private readonly prisma: PrismaService) {}

  private get backupDir(): string {
    return process.env.BACKUP_DIR ?? join(process.cwd(), 'backups');
  }

  private get retentionDays(): number {
    const parsed = parseInt(process.env.BACKUP_RETENTION_DAYS ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RETENTION_DAYS;
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async runScheduledBackup(): Promise<void> {
    try {
      const filePath = await this.runBackup();
      this.logger.log(`Backup written to ${filePath}`);
      const pruned = await this.pruneOldBackups();
      if (pruned.length > 0) {
        this.logger.log(`Pruned ${pruned.length} backup(s) older than ${this.retentionDays} days`);
      }
    } catch (err) {
      this.logger.error('Scheduled backup failed', err instanceof Error ? err.stack : err);
    }
  }

  /** Dumps every row of every table to a single timestamped JSON file. Returns the file path written. */
  async runBackup(): Promise<string> {
    await mkdir(this.backupDir, { recursive: true });

    const [companies, employees, connectors, sensitiveEntities, auditLogs, healthChecks] = await Promise.all([
      this.prisma.company.findMany(),
      this.prisma.employee.findMany(),
      this.prisma.connector.findMany(),
      this.prisma.sensitiveEntity.findMany(),
      this.prisma.auditLog.findMany(),
      this.prisma.healthCheck.findMany(),
    ]);

    const takenAt = new Date();
    const dump = {
      takenAt: takenAt.toISOString(),
      companies,
      employees,
      connectors,
      sensitiveEntities,
      auditLogs,
      healthChecks,
    };

    const fileName = `${BACKUP_FILE_PREFIX}${takenAt.toISOString().replace(/[:.]/g, '-')}${BACKUP_FILE_SUFFIX}`;
    const filePath = join(this.backupDir, fileName);
    await writeFile(filePath, JSON.stringify(dump), 'utf-8');
    return filePath;
  }

  /** Deletes backup files older than the retention window. Returns the file names removed. */
  async pruneOldBackups(): Promise<string[]> {
    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
    let entries: string[];
    try {
      entries = await readdir(this.backupDir);
    } catch {
      return [];
    }

    const removed: string[] = [];
    for (const entry of entries) {
      if (!entry.startsWith(BACKUP_FILE_PREFIX) || !entry.endsWith(BACKUP_FILE_SUFFIX)) continue;
      const timestampPart = entry.slice(BACKUP_FILE_PREFIX.length, -BACKUP_FILE_SUFFIX.length);
      // Reverse the ':'/'.' -> '-' substitution from the filename back into a parseable ISO timestamp.
      const isoGuess = timestampPart.replace(
        /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
        '$1T$2:$3:$4.$5Z',
      );
      const takenAt = Date.parse(isoGuess);
      if (Number.isNaN(takenAt) || takenAt >= cutoff) continue;
      await rm(join(this.backupDir, entry));
      removed.push(entry);
    }
    return removed;
  }
}
