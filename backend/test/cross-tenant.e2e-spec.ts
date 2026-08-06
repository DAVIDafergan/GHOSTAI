import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const SUPER_ADMIN_USERNAME = process.env.SUPER_ADMIN_USERNAME as string;
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD as string;

jest.setTimeout(30000);

/**
 * Dedicated cross-tenant authorization audit: every endpoint that accepts a
 * resource :id must scope its lookup to the caller's own companyId, so that
 * Company A's apiKey/extensionKey can never read, modify, or delete
 * anything belonging to Company B just by guessing/reusing B's resource
 * ids. Each check below creates two fully separate companies and tries to
 * reach across from one to the other.
 */
describe('Cross-tenant authorization (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  let companyAApiKey: string;
  let companyAId: string;
  let companyBApiKey: string;
  let companyBId: string;
  let employeeAId: string;
  let employeeAExtensionKey: string;
  let employeeBId: string;
  let employeeBExtensionKey: string;
  let connectorAId: string;
  let connectorBId: string;

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

    const companyA = await request(app.getHttpServer())
      .post('/admin/companies')
      .set('x-admin-username', SUPER_ADMIN_USERNAME)
      .set('x-admin-password', SUPER_ADMIN_PASSWORD)
      .send({ name: 'Cross-Tenant Co A' })
      .expect(201);
    companyAApiKey = companyA.body.apiKey;
    companyAId = companyA.body.id;

    const companyB = await request(app.getHttpServer())
      .post('/admin/companies')
      .set('x-admin-username', SUPER_ADMIN_USERNAME)
      .set('x-admin-password', SUPER_ADMIN_PASSWORD)
      .send({ name: 'Cross-Tenant Co B' })
      .expect(201);
    companyBApiKey = companyB.body.apiKey;
    companyBId = companyB.body.id;

    const employeeA = await request(app.getHttpServer())
      .post('/employees')
      .set('x-api-key', companyAApiKey)
      .send({ email: 'employee-a@co-a.test' })
      .expect(201);
    employeeAId = employeeA.body.id;
    employeeAExtensionKey = employeeA.body.extensionKey;

    const employeeB = await request(app.getHttpServer())
      .post('/employees')
      .set('x-api-key', companyBApiKey)
      .send({ email: 'employee-b@co-b.test' })
      .expect(201);
    employeeBId = employeeB.body.id;
    employeeBExtensionKey = employeeB.body.extensionKey;

    const connectorA = await request(app.getHttpServer())
      .post('/connectors')
      .set('x-api-key', companyAApiKey)
      .send({ sourceType: 'csv' })
      .expect(201);
    connectorAId = connectorA.body.id;

    const connectorB = await request(app.getHttpServer())
      .post('/connectors')
      .set('x-api-key', companyBApiKey)
      .send({ sourceType: 'csv' })
      .expect(201);
    connectorBId = connectorB.body.id;

    await request(app.getHttpServer())
      .post('/entities/batch')
      .set('x-api-key', companyAApiKey)
      .send({ entities: [{ entityHash: 'co-a-secret-hash', entityType: 'name', confidence: 90 }] })
      .expect(201);
  });

  afterAll(async () => {
    for (const id of [companyAId, companyBId]) {
      await prisma.sensitiveEntity.deleteMany({ where: { companyId: id } });
      await prisma.auditLog.deleteMany({ where: { companyId: id } });
      await prisma.connector.deleteMany({ where: { companyId: id } });
      await prisma.employee.deleteMany({ where: { companyId: id } });
      await prisma.healthCheck.deleteMany({ where: { companyId: id } });
    }
    await prisma.company.deleteMany({ where: { id: { in: [companyAId, companyBId] } } });
    await app.close();
  });

  it('employees: A cannot read B\'s employee by id', async () => {
    await request(app.getHttpServer())
      .get(`/employees/${employeeBId}`)
      .set('x-api-key', companyAApiKey)
      .expect(404);
  });

  it('employees: A cannot disable B\'s employee by id', async () => {
    await request(app.getHttpServer())
      .delete(`/employees/${employeeBId}`)
      .set('x-api-key', companyAApiKey)
      .expect(404);
    // Confirm B's employee is genuinely untouched, not silently disabled.
    const stillWorks = await request(app.getHttpServer())
      .get('/employees/me')
      .set('x-extension-key', employeeBExtensionKey);
    expect(stillWorks.status).toBe(200);
  });

  it("employees: A's list only ever contains A's own employees", async () => {
    const res = await request(app.getHttpServer())
      .get('/employees')
      .set('x-api-key', companyAApiKey)
      .expect(200);
    expect(res.body.map((e: { id: string }) => e.id)).not.toContain(employeeBId);
  });

  it('connectors: A cannot start/complete/fail a sync on B\'s connector', async () => {
    await request(app.getHttpServer())
      .post(`/connectors/${connectorBId}/sync/start`)
      .set('x-api-key', companyAApiKey)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/connectors/${connectorBId}/sync/complete`)
      .set('x-api-key', companyAApiKey)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/connectors/${connectorBId}/sync/fail`)
      .set('x-api-key', companyAApiKey)
      .expect(404);
  });

  it('connectors: A cannot delete B\'s connector', async () => {
    await request(app.getHttpServer())
      .delete(`/connectors/${connectorBId}`)
      .set('x-api-key', companyAApiKey)
      .expect(404);
    const stillThere = await prisma.connector.findUnique({ where: { id: connectorBId } });
    expect(stillThere).not.toBeNull();
  });

  it("connectors: A's list only ever contains A's own connectors", async () => {
    const res = await request(app.getHttpServer())
      .get('/connectors')
      .set('x-api-key', companyAApiKey)
      .expect(200);
    expect(res.body.map((c: { id: string }) => c.id)).not.toContain(connectorBId);
  });

  it('entities: A cannot ingest a batch tagged with B\'s connectorId', async () => {
    await request(app.getHttpServer())
      .post('/entities/batch')
      .set('x-api-key', companyAApiKey)
      .send({
        connectorId: connectorBId,
        entities: [{ entityHash: 'attempted-cross-tenant-hash', entityType: 'name', confidence: 90 }],
      })
      .expect(404);
  });

  it("entities: B's extension key never sees A's entity hashes", async () => {
    const res = await request(app.getHttpServer())
      .get('/entities')
      .set('x-extension-key', employeeBExtensionKey)
      .expect(200);
    expect(res.body.entities.map((e: { entityHash: string }) => e.entityHash)).not.toContain(
      'co-a-secret-hash',
    );
  });

  it("audit-logs: filtering by A's employeeId from B's apiKey returns nothing, not A's logs", async () => {
    await request(app.getHttpServer())
      .post('/audit-logs')
      .set('x-extension-key', employeeAExtensionKey)
      .send({ eventType: 'blocked', entityType: 'name' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/audit-logs')
      .set('x-api-key', companyBApiKey)
      .query({ employeeId: employeeAId })
      .expect(200);
    expect(res.body.logs).toHaveLength(0);
  });

  it("audit-logs: B's log list never contains A's events", async () => {
    const res = await request(app.getHttpServer())
      .get('/audit-logs')
      .set('x-api-key', companyBApiKey)
      .expect(200);
    expect(res.body.logs.every((l: { employeeEmail: string }) => l.employeeEmail !== 'employee-a@co-a.test')).toBe(
      true,
    );
  });

  it("dashboard: B's summary counts never include A's data", async () => {
    const res = await request(app.getHttpServer())
      .get('/dashboard/summary')
      .set('x-api-key', companyBApiKey)
      .expect(200);
    // A has 1 entity ingested and 1 block logged in earlier tests; B has none of its own yet.
    expect(res.body.entitiesCount).toBe(0);
    expect(res.body.blocksThisMonth).toBe(0);
  });

  it("session: employee B's /employees/me never exposes company A's entitySalt", async () => {
    const [meB, meCompanyA, meCompanyB] = await Promise.all([
      request(app.getHttpServer()).get('/employees/me').set('x-extension-key', employeeBExtensionKey).expect(200),
      request(app.getHttpServer()).get('/companies/me').set('x-api-key', companyAApiKey).expect(200),
      request(app.getHttpServer()).get('/companies/me').set('x-api-key', companyBApiKey).expect(200),
    ]);
    expect(meB.body.company.entitySalt).toBe(meCompanyB.body.entitySalt);
    expect(meB.body.company.entitySalt).not.toBe(meCompanyA.body.entitySalt);
  });

  it("health-check: B's latest check is never A's", async () => {
    await request(app.getHttpServer()).post('/health-check/run').set('x-api-key', companyAApiKey).expect(201);
    const res = await request(app.getHttpServer())
      .get('/health-check/latest')
      .set('x-api-key', companyBApiKey)
      .expect(200);
    // B never ran a check in this suite - must not see A's result by accident.
    // (getLatest returns Prisma's `null` when none exists; supertest/express
    // serialize that as an empty body rather than a literal `null` field, so
    // assert on the absence of a real record rather than exact null shape.)
    expect(res.body?.id).toBeUndefined();
    expect(res.body?.companyId).not.toBe(companyAId);
  });

  it('a company\'s own apiKey cannot be used as another company\'s extensionKey or vice versa', async () => {
    await request(app.getHttpServer())
      .get('/entities')
      .set('x-extension-key', companyAApiKey)
      .expect(401);
    await request(app.getHttpServer())
      .get('/connectors')
      .set('x-api-key', employeeAExtensionKey)
      .expect(401);
  });
});
