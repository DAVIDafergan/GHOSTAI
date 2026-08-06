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
 * SuperAdminGuard replaced a single shared ADMIN_BOOTSTRAP_SECRET with a
 * username+password pair - proves both are actually required together,
 * not just checked independently (e.g. a bug where only the password
 * mattered and the username was accepted regardless would still pass a
 * naive "wrong creds get 401" test using two wrong values at once).
 */
describe('Super admin auth (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let createdCompanyId: string | undefined;

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
    if (createdCompanyId) {
      await prisma.company.delete({ where: { id: createdCompanyId } });
    }
    await app.close();
  });

  it('accepts the correct username and password together', async () => {
    const res = await request(app.getHttpServer())
      .post('/admin/companies')
      .set('x-admin-username', SUPER_ADMIN_USERNAME)
      .set('x-admin-password', SUPER_ADMIN_PASSWORD)
      .send({ name: 'Super Admin Auth Test Co - valid' });
    expect(res.status).toBe(201);
    createdCompanyId = res.body.id;
  });

  it('rejects the correct username with a wrong password', async () => {
    await request(app.getHttpServer())
      .post('/admin/companies')
      .set('x-admin-username', SUPER_ADMIN_USERNAME)
      .set('x-admin-password', 'wrong-password')
      .send({ name: 'Super Admin Auth Test Co - wrong password' })
      .expect(401);
  });

  it('rejects a wrong username with the correct password', async () => {
    await request(app.getHttpServer())
      .post('/admin/companies')
      .set('x-admin-username', 'wrong-username')
      .set('x-admin-password', SUPER_ADMIN_PASSWORD)
      .send({ name: 'Super Admin Auth Test Co - wrong username' })
      .expect(401);
  });

  it('rejects when only the username header is present', async () => {
    await request(app.getHttpServer())
      .post('/admin/companies')
      .set('x-admin-username', SUPER_ADMIN_USERNAME)
      .send({ name: 'Super Admin Auth Test Co - no password header' })
      .expect(401);
  });

  it('rejects when only the password header is present', async () => {
    await request(app.getHttpServer())
      .post('/admin/companies')
      .set('x-admin-password', SUPER_ADMIN_PASSWORD)
      .send({ name: 'Super Admin Auth Test Co - no username header' })
      .expect(401);
  });

  it('rejects when neither header is present', async () => {
    await request(app.getHttpServer())
      .post('/admin/companies')
      .send({ name: 'Super Admin Auth Test Co - no headers' })
      .expect(401);
  });
});
