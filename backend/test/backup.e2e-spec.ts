import 'dotenv/config';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { BackupService } from '../src/backup/backup.service';
import { generateSecret, hashSecret } from '../src/common/crypto/hashing.util';

jest.setTimeout(30000);

describe('Backups (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let backupService: BackupService;
  let backupDir: string;
  let companyId: string;

  beforeAll(async () => {
    backupDir = await mkdtemp(join(tmpdir(), 'pii-shield-backup-test-'));
    process.env.BACKUP_DIR = backupDir;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    backupService = app.get(BackupService);

    const company = await prisma.company.create({
      data: { name: 'Backup Test Co', apiKeyHash: hashSecret(generateSecret()) },
    });
    companyId = company.id;
  });

  afterAll(async () => {
    await prisma.company.delete({ where: { id: companyId } });
    await app.close();
    await rm(backupDir, { recursive: true, force: true });
    delete process.env.BACKUP_DIR;
  });

  it('writes a JSON dump containing every table, including the test company, with only hashed secrets', async () => {
    const filePath = await backupService.runBackup();
    const raw = await readFile(filePath, 'utf-8');
    const dump = JSON.parse(raw);

    expect(dump.takenAt).toBeDefined();
    for (const table of ['companies', 'employees', 'connectors', 'sensitiveEntities', 'auditLogs', 'healthChecks']) {
      expect(Array.isArray(dump[table])).toBe(true);
    }

    const backedUpCompany = dump.companies.find((c: { id: string }) => c.id === companyId);
    expect(backedUpCompany).toBeDefined();
    expect(backedUpCompany.name).toBe('Backup Test Co');
    // apiKeyHash must be a hash (hex, fixed length), never a raw secret.
    expect(backedUpCompany.apiKeyHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('prunes backups older than the retention window but keeps recent ones', async () => {
    process.env.BACKUP_RETENTION_DAYS = '14';

    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 30);
    const oldFileName = `backup-${oldDate.toISOString().replace(/[:.]/g, '-')}.json`;
    await writeFile(join(backupDir, oldFileName), '{}', 'utf-8');

    const recentFilePath = await backupService.runBackup();

    const removed = await backupService.pruneOldBackups();

    expect(removed).toContain(oldFileName);
    await expect(readFile(join(backupDir, oldFileName), 'utf-8')).rejects.toThrow();
    await expect(readFile(recentFilePath, 'utf-8')).resolves.toBeDefined();

    delete process.env.BACKUP_RETENTION_DAYS;
  });
});
