import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { DashboardService } from '../src/dashboard/dashboard.service';
import { generateSecret, hashSecret } from '../src/common/crypto/hashing.util';

jest.setTimeout(30000);

/**
 * Proves the global exception filter (all-exceptions.filter.ts) actually
 * does what it claims: an unexpected, uncaught error (not one of our own
 * HttpExceptions) must never reach the client as a stack trace or raw
 * error message - only a generic 500. Forces this deterministically by
 * overriding a service method to throw a raw internal-looking error,
 * rather than hoping to stumble into a real bug.
 */
describe('Global error handling (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let apiKey: string;
  let companyId: string;

  beforeAll(async () => {
    const internalError = new Error('ECONNREFUSED at /internal/db-pool.ts:42 - connection to 10.0.4.12 failed');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DashboardService)
      .useValue({
        getSummary: () => {
          throw internalError;
        },
        getAnomalies: () => ({ anomalies: [], windowDays: 7 }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    const apiKeyPlain = generateSecret();
    const company = await prisma.company.create({
      data: { name: 'Error Handling Test Co', apiKeyHash: hashSecret(apiKeyPlain) },
    });
    apiKey = apiKeyPlain;
    companyId = company.id;
  });

  afterAll(async () => {
    await prisma.company.delete({ where: { id: companyId } });
    await app.close();
  });

  it('returns a generic 500 with no stack trace or internal detail when a service throws unexpectedly', async () => {
    const res = await request(app.getHttpServer())
      .get('/dashboard/summary')
      .set('x-api-key', apiKey)
      .expect(500);

    expect(res.body).toEqual({ statusCode: 500, message: 'Internal server error' });
    const bodyText = JSON.stringify(res.body);
    expect(bodyText).not.toMatch(/ECONNREFUSED/);
    expect(bodyText).not.toMatch(/db-pool\.ts/);
    expect(bodyText).not.toMatch(/10\.0\.4\.12/);
    expect(bodyText).not.toContain('at ');
    expect(res.body.stack).toBeUndefined();
  });

  it('still returns normal, deliberately-crafted messages for our own HttpExceptions (regression check)', async () => {
    const res = await request(app.getHttpServer()).get('/admin/companies/nonexistent-id').expect(401);
    expect(res.body.message).toBeDefined();
  });
});
