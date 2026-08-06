import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN_SECRET = process.env.ADMIN_BOOTSTRAP_SECRET as string;

jest.setTimeout(30000);

describe('PII Shield backend (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  it('rejects company creation without the admin bootstrap secret', async () => {
    await request(app.getHttpServer())
      .post('/admin/companies')
      .send({ name: 'Rejected Co' })
      .expect(401);
  });

  it('supports the full week-1 flow: create company -> ingest hashes -> retrieve via extension endpoint', async () => {
    // 1. Create a company (admin-only)
    const companyRes = await request(app.getHttpServer())
      .post('/admin/companies')
      .set('x-admin-secret', ADMIN_SECRET)
      .send({ name: 'Acme Law Offices', adminEmail: 'admin@acme-law.test' })
      .expect(201);

    expect(companyRes.body.apiKey).toBeDefined();
    const apiKey = companyRes.body.apiKey as string;
    const companyId = companyRes.body.id as string;

    // 2. Register an employee, receive an extensionKey
    const employeeRes = await request(app.getHttpServer())
      .post('/employees')
      .set('x-api-key', apiKey)
      .send({ email: 'employee@acme-law.test' })
      .expect(201);

    const extensionKey = employeeRes.body.extensionKey as string;
    expect(extensionKey).toBeDefined();

    // 3. Manually feed sensitive entity hashes (as the connector would)
    await request(app.getHttpServer())
      .post('/entities/batch')
      .set('x-api-key', apiKey)
      .send({
        entities: [
          { entityHash: 'hash-of-avner-cohen', entityType: 'name', confidence: 90 },
          { entityHash: 'hash-of-123456789', entityType: 'id_number', confidence: 100 },
        ],
      })
      .expect(201);

    // 4. Retrieve hashes back through the extension-facing endpoint
    const listRes = await request(app.getHttpServer())
      .get('/entities')
      .set('x-extension-key', extensionKey)
      .expect(200);

    expect(listRes.body.entities).toHaveLength(2);
    expect(listRes.body.entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityHash: 'hash-of-avner-cohen', entityType: 'name' }),
        expect.objectContaining({ entityHash: 'hash-of-123456789', entityType: 'id_number' }),
      ]),
    );

    // 5. A different company's employee must not see these entities (tenant isolation)
    const otherCompanyRes = await request(app.getHttpServer())
      .post('/admin/companies')
      .set('x-admin-secret', ADMIN_SECRET)
      .send({ name: 'Other Co' })
      .expect(201);
    const otherEmployeeRes = await request(app.getHttpServer())
      .post('/employees')
      .set('x-api-key', otherCompanyRes.body.apiKey)
      .send({ email: 'someone@other-co.test' })
      .expect(201);
    const otherListRes = await request(app.getHttpServer())
      .get('/entities')
      .set('x-extension-key', otherEmployeeRes.body.extensionKey)
      .expect(200);
    expect(otherListRes.body.entities).toHaveLength(0);

    // cleanup
    await prisma.sensitiveEntity.deleteMany({ where: { companyId } });
    await prisma.employee.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
    await prisma.employee.deleteMany({ where: { companyId: otherCompanyRes.body.id } });
    await prisma.company.delete({ where: { id: otherCompanyRes.body.id } });
  });

  it('exposes the company entitySalt to the company via api-key and to employees via extensionKey', async () => {
    const companyRes = await request(app.getHttpServer())
      .post('/admin/companies')
      .set('x-admin-secret', ADMIN_SECRET)
      .send({ name: 'Salt Test Co' })
      .expect(201);
    const apiKey = companyRes.body.apiKey as string;

    const companyMeRes = await request(app.getHttpServer())
      .get('/companies/me')
      .set('x-api-key', apiKey)
      .expect(200);
    expect(companyMeRes.body.entitySalt).toBeDefined();

    const employeeRes = await request(app.getHttpServer())
      .post('/employees')
      .set('x-api-key', apiKey)
      .send({ email: 'salt-test@salt-test.test' })
      .expect(201);

    const employeeMeRes = await request(app.getHttpServer())
      .get('/employees/me')
      .set('x-extension-key', employeeRes.body.extensionKey)
      .expect(200);
    expect(employeeMeRes.body.company.entitySalt).toBe(companyMeRes.body.entitySalt);

    await prisma.employee.deleteMany({ where: { companyId: companyRes.body.id } });
    await prisma.company.delete({ where: { id: companyRes.body.id } });
  });

  it('rejects a disabled employee extension key', async () => {
    const companyRes = await request(app.getHttpServer())
      .post('/admin/companies')
      .set('x-admin-secret', ADMIN_SECRET)
      .send({ name: 'Disable Test Co' })
      .expect(201);

    const employeeRes = await request(app.getHttpServer())
      .post('/employees')
      .set('x-api-key', companyRes.body.apiKey)
      .send({ email: 'leaver@disable-test.test' })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/employees/${employeeRes.body.id}`)
      .set('x-api-key', companyRes.body.apiKey)
      .expect(200);

    await request(app.getHttpServer())
      .get('/entities')
      .set('x-extension-key', employeeRes.body.extensionKey)
      .expect(401);

    await prisma.employee.deleteMany({ where: { companyId: companyRes.body.id } });
    await prisma.company.delete({ where: { id: companyRes.body.id } });
  });

  it('prunes stale entities from a connector when a sync run completes', async () => {
    const companyRes = await request(app.getHttpServer())
      .post('/admin/companies')
      .set('x-admin-secret', ADMIN_SECRET)
      .send({ name: 'Sync Test Co' })
      .expect(201);
    const apiKey = companyRes.body.apiKey as string;
    const companyId = companyRes.body.id as string;

    const connectorRes = await request(app.getHttpServer())
      .post('/connectors')
      .set('x-api-key', apiKey)
      .send({ sourceType: 'csv' })
      .expect(201);
    const connectorId = connectorRes.body.id as string;

    // First sync run: ingest one entity, then complete.
    await request(app.getHttpServer())
      .post(`/connectors/${connectorId}/sync/start`)
      .set('x-api-key', apiKey)
      .expect(201);
    await request(app.getHttpServer())
      .post('/entities/batch')
      .set('x-api-key', apiKey)
      .send({ connectorId, entities: [{ entityHash: 'stale-hash', entityType: 'name', confidence: 80 }] })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/connectors/${connectorId}/sync/complete`)
      .set('x-api-key', apiKey)
      .expect(201);

    // Second sync run: the previously-seen entity no longer appears at the
    // source (e.g. the customer was deleted), so it must be pruned once
    // this run completes.
    await request(app.getHttpServer())
      .post(`/connectors/${connectorId}/sync/start`)
      .set('x-api-key', apiKey)
      .expect(201);
    await request(app.getHttpServer())
      .post('/entities/batch')
      .set('x-api-key', apiKey)
      .send({ connectorId, entities: [{ entityHash: 'fresh-hash', entityType: 'name', confidence: 80 }] })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/connectors/${connectorId}/sync/complete`)
      .set('x-api-key', apiKey)
      .expect(201);

    const remaining = await prisma.sensitiveEntity.findMany({ where: { companyId } });
    expect(remaining.map((e) => e.entityHash)).toEqual(['fresh-hash']);

    await prisma.sensitiveEntity.deleteMany({ where: { companyId } });
    await prisma.connector.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  });

  it('records audit log events from the extension and surfaces them via the dashboard summary and settings', async () => {
    const companyRes = await request(app.getHttpServer())
      .post('/admin/companies')
      .set('x-admin-secret', ADMIN_SECRET)
      .send({ name: 'Dashboard Test Co' })
      .expect(201);
    const apiKey = companyRes.body.apiKey as string;
    const companyId = companyRes.body.id as string;

    const employeeRes = await request(app.getHttpServer())
      .post('/employees')
      .set('x-api-key', apiKey)
      .send({ email: 'dashboard-test@dashboard-test.test' })
      .expect(201);
    const extensionKey = employeeRes.body.extensionKey as string;

    await request(app.getHttpServer())
      .post('/audit-logs')
      .set('x-extension-key', extensionKey)
      .send({ eventType: 'blocked', entityType: 'name' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/audit-logs')
      .set('x-extension-key', extensionKey)
      .send({ eventType: 'blocked', entityType: 'id_number' })
      .expect(201);

    const logsRes = await request(app.getHttpServer())
      .get('/audit-logs')
      .set('x-api-key', apiKey)
      .expect(200);
    expect(logsRes.body.logs).toHaveLength(2);
    expect(logsRes.body.logs[0].employeeEmail).toBe('dashboard-test@dashboard-test.test');

    const summaryRes = await request(app.getHttpServer())
      .get('/dashboard/summary')
      .set('x-api-key', apiKey)
      .expect(200);
    expect(summaryRes.body.blocksThisMonth).toBe(2);
    expect(summaryRes.body.totalEmployees).toBe(1);
    expect(summaryRes.body.entitiesCount).toBe(0);

    const settingsRes = await request(app.getHttpServer())
      .patch('/companies/me')
      .set('x-api-key', apiKey)
      .send({ confidenceThreshold: 75, enabledEntityTypes: ['name', 'email'] })
      .expect(200);
    expect(settingsRes.body.confidenceThreshold).toBe(75);
    expect(settingsRes.body.enabledEntityTypes).toEqual(['name', 'email']);

    const meRes = await request(app.getHttpServer())
      .get('/companies/me')
      .set('x-api-key', apiKey)
      .expect(200);
    expect(meRes.body.confidenceThreshold).toBe(75);
    expect(meRes.body.enabledEntityTypes).toEqual(['name', 'email']);

    await prisma.auditLog.deleteMany({ where: { companyId } });
    await prisma.employee.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  });

  it('reports a computed employee status (not_installed / active / disabled)', async () => {
    const companyRes = await request(app.getHttpServer())
      .post('/admin/companies')
      .set('x-admin-secret', ADMIN_SECRET)
      .send({ name: 'Employee Status Test Co' })
      .expect(201);
    const apiKey = companyRes.body.apiKey as string;
    const companyId = companyRes.body.id as string;

    const notInstalledRes = await request(app.getHttpServer())
      .post('/employees')
      .set('x-api-key', apiKey)
      .send({ email: 'not-installed@status-test.test' })
      .expect(201);

    const activeRes = await request(app.getHttpServer())
      .post('/employees')
      .set('x-api-key', apiKey)
      .send({ email: 'active@status-test.test' })
      .expect(201);
    // Employee's first authenticated request marks activatedAt/lastActiveAt.
    await request(app.getHttpServer())
      .get('/employees/me')
      .set('x-extension-key', activeRes.body.extensionKey)
      .expect(200);

    const disabledRes = await request(app.getHttpServer())
      .post('/employees')
      .set('x-api-key', apiKey)
      .send({ email: 'disabled@status-test.test' })
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/employees/${disabledRes.body.id}`)
      .set('x-api-key', apiKey)
      .expect(200);

    const listRes = await request(app.getHttpServer())
      .get('/employees')
      .set('x-api-key', apiKey)
      .expect(200);
    const byEmail = Object.fromEntries(listRes.body.map((e: { email: string; status: string }) => [e.email, e.status]));
    expect(byEmail['not-installed@status-test.test']).toBe('not_installed');
    expect(byEmail['active@status-test.test']).toBe('active');
    expect(byEmail['disabled@status-test.test']).toBe('disabled');

    await prisma.employee.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  });

  it('returns a single employee with name and total block count via GET /employees/:id', async () => {
    const companyRes = await request(app.getHttpServer())
      .post('/admin/companies')
      .set('x-admin-secret', ADMIN_SECRET)
      .send({ name: 'Employee Detail Test Co' })
      .expect(201);
    const apiKey = companyRes.body.apiKey as string;
    const companyId = companyRes.body.id as string;

    const employeeRes = await request(app.getHttpServer())
      .post('/employees')
      .set('x-api-key', apiKey)
      .send({ email: 'detail@detail-test.test', name: 'Detail Employee' })
      .expect(201);
    expect(employeeRes.body.name).toBe('Detail Employee');
    const employeeId = employeeRes.body.id as string;
    const extensionKey = employeeRes.body.extensionKey as string;

    await request(app.getHttpServer())
      .post('/audit-logs')
      .set('x-extension-key', extensionKey)
      .send({ eventType: 'blocked', entityType: 'name', platform: 'chatgpt.com' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/audit-logs')
      .set('x-extension-key', extensionKey)
      .send({ eventType: 'blocked', entityType: 'id_number', platform: 'claude.ai' })
      .expect(201);

    const detailRes = await request(app.getHttpServer())
      .get(`/employees/${employeeId}`)
      .set('x-api-key', apiKey)
      .expect(200);
    expect(detailRes.body.name).toBe('Detail Employee');
    expect(detailRes.body.email).toBe('detail@detail-test.test');
    expect(detailRes.body.blockCount).toBe(2);

    const listRes = await request(app.getHttpServer())
      .get('/employees')
      .set('x-api-key', apiKey)
      .expect(200);
    expect(listRes.body[0].blockCount).toBe(2);

    const historyRes = await request(app.getHttpServer())
      .get('/audit-logs')
      .set('x-api-key', apiKey)
      .query({ employeeId })
      .expect(200);
    expect(historyRes.body.logs).toHaveLength(2);
    expect(historyRes.body.logs.map((l: { platform: string }) => l.platform).sort()).toEqual([
      'chatgpt.com',
      'claude.ai',
    ]);

    await prisma.auditLog.deleteMany({ where: { companyId } });
    await prisma.employee.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  });

  it('flags an employee with far more blocks than peers, repeated overrides, and unusual-hour activity', async () => {
    const companyRes = await request(app.getHttpServer())
      .post('/admin/companies')
      .set('x-admin-secret', ADMIN_SECRET)
      .send({ name: 'Anomaly Test Co' })
      .expect(201);
    const apiKey = companyRes.body.apiKey as string;
    const companyId = companyRes.body.id as string;

    const [aRes, bRes, cRes] = await Promise.all(
      ['a', 'b', 'c'].map((label) =>
        request(app.getHttpServer())
          .post('/employees')
          .set('x-api-key', apiKey)
          .send({ email: `${label}@anomaly-test.test` })
          .expect(201),
      ),
    );

    // A: 6 ordinary blocks (recent) -> should trip the "far more than peers"
    // threshold. B: 1 block. C: 0 blocks. Median of B/C = 0.5, so 6 > 3*0.5
    // and 6 >= the absolute floor of 5.
    for (let i = 0; i < 6; i++) {
      await prisma.auditLog.create({
        data: { companyId, employeeId: aRes.body.id, eventType: 'blocked', entityType: 'name' },
      });
    }
    await prisma.auditLog.create({
      data: { companyId, employeeId: bRes.body.id, eventType: 'blocked', entityType: 'name' },
    });

    // A: 3 override attempts -> trips the "repeated override" threshold.
    for (let i = 0; i < 3; i++) {
      await prisma.auditLog.create({
        data: { companyId, employeeId: aRes.body.id, eventType: 'user_override', entityType: 'name' },
      });
    }

    // A: 3 blocks at 3am UTC -> trips the "unusual hours" threshold. These
    // count toward blocksThisWeek too, but that's fine, doesn't change the
    // high_blocks verdict.
    const threeAmUtc = new Date();
    threeAmUtc.setUTCHours(3, 0, 0, 0);
    for (let i = 0; i < 3; i++) {
      await prisma.auditLog.create({
        data: { companyId, employeeId: aRes.body.id, eventType: 'blocked', entityType: 'name', createdAt: threeAmUtc },
      });
    }

    const anomaliesRes = await request(app.getHttpServer())
      .get('/dashboard/anomalies')
      .set('x-api-key', apiKey)
      .expect(200);

    const byEmployee = Object.fromEntries(
      anomaliesRes.body.anomalies.map((a: { employeeId: string; reasons: { type: string }[] }) => [
        a.employeeId,
        a.reasons.map((r) => r.type),
      ]),
    );
    expect(byEmployee[aRes.body.id]).toEqual(
      expect.arrayContaining(['high_blocks', 'repeated_override', 'unusual_hours']),
    );
    expect(byEmployee[bRes.body.id]).toBeUndefined();
    expect(byEmployee[cRes.body.id]).toBeUndefined();

    await prisma.auditLog.deleteMany({ where: { companyId } });
    await prisma.employee.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  });

  it('runs a synthetic health check that succeeds and is retrievable via latest', async () => {
    const companyRes = await request(app.getHttpServer())
      .post('/admin/companies')
      .set('x-admin-secret', ADMIN_SECRET)
      .send({ name: 'Health Check Test Co' })
      .expect(201);
    const apiKey = companyRes.body.apiKey as string;
    const companyId = companyRes.body.id as string;

    const runRes = await request(app.getHttpServer())
      .post('/health-check/run')
      .set('x-api-key', apiKey)
      .expect(201);
    expect(runRes.body.success).toBe(true);

    const latestRes = await request(app.getHttpServer())
      .get('/health-check/latest')
      .set('x-api-key', apiKey)
      .expect(200);
    expect(latestRes.body.success).toBe(true);
    expect(latestRes.body.id).toBe(runRes.body.id);

    await prisma.healthCheck.deleteMany({ where: { companyId } });
    await prisma.sensitiveEntity.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  });

  it('lists all companies with aggregated stats for the super-admin dashboard, gated by the admin secret', async () => {
    const companyRes = await request(app.getHttpServer())
      .post('/admin/companies')
      .set('x-admin-secret', ADMIN_SECRET)
      .send({ name: 'Super Admin List Test Co' })
      .expect(201);
    const apiKey = companyRes.body.apiKey as string;
    const companyId = companyRes.body.id as string;

    await request(app.getHttpServer())
      .post('/employees')
      .set('x-api-key', apiKey)
      .send({ email: 'a@super-admin-list-test.test' })
      .expect(201);
    const employeeRes = await request(app.getHttpServer())
      .post('/employees')
      .set('x-api-key', apiKey)
      .send({ email: 'b@super-admin-list-test.test' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/audit-logs')
      .set('x-extension-key', employeeRes.body.extensionKey)
      .send({ eventType: 'blocked', entityType: 'name' })
      .expect(201);

    const connectorRes = await request(app.getHttpServer())
      .post('/connectors')
      .set('x-api-key', apiKey)
      .send({ sourceType: 'csv' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/connectors/${connectorRes.body.id}/sync/start`)
      .set('x-api-key', apiKey)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/connectors/${connectorRes.body.id}/sync/complete`)
      .set('x-api-key', apiKey)
      .expect(201);

    await request(app.getHttpServer())
      .post('/health-check/run')
      .set('x-api-key', apiKey)
      .expect(201);

    await request(app.getHttpServer()).get('/admin/companies').expect(401);

    const listRes = await request(app.getHttpServer())
      .get('/admin/companies')
      .set('x-admin-secret', ADMIN_SECRET)
      .expect(200);
    const entry = listRes.body.find((c: { id: string }) => c.id === companyId);
    expect(entry).toBeDefined();
    expect(entry.employeeCount).toBe(2);
    expect(entry.blocksThisMonth).toBe(1);
    expect(entry.connectorStatus).toBe('connected');
    expect(entry.healthCheckSuccess).toBe(true);

    await prisma.healthCheck.deleteMany({ where: { companyId } });
    await prisma.auditLog.deleteMany({ where: { companyId } });
    await prisma.sensitiveEntity.deleteMany({ where: { companyId } });
    await prisma.connector.deleteMany({ where: { companyId } });
    await prisma.employee.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  });
});
