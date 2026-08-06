import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

// Own app instance, separate from pii-shield.e2e-spec.ts, so this suite's
// deliberate rate-limit exhaustion doesn't share/pollute the throttle budget
// used by the other file's 12 legitimate /admin/companies calls.
describe('Rate limiting (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  it('blocks brute-forcing ADMIN_BOOTSTRAP_SECRET on POST /admin/companies past the configured limit', async () => {
    // CompaniesController is throttled to 30 requests / 15min (see
    // companies.controller.ts). Fire past that with a wrong secret and
    // confirm we eventually get 429s, proving the guard actually rejects
    // excess traffic rather than just being wired up inertly.
    const results: number[] = [];
    for (let i = 0; i < 35; i++) {
      const res = await request(app.getHttpServer())
        .post('/admin/companies')
        .set('x-admin-secret', 'definitely-wrong-secret')
        .send({ name: `Brute Force Attempt ${i}` });
      results.push(res.status);
    }

    // First 30 should be rejected as unauthorized (wrong secret, not yet
    // throttled); everything past that should be rejected as too-many-requests.
    const unauthorizedCount = results.filter((s) => s === 401).length;
    const throttledCount = results.filter((s) => s === 429).length;

    expect(unauthorizedCount).toBe(30);
    expect(throttledCount).toBe(5);
    expect(results.slice(30)).toEqual(new Array(5).fill(429));
  });
});
