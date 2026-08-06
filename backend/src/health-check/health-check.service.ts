import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Company } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { computeEntityHash } from '../common/crypto/hashing.util';

/**
 * Fixed, non-secret marker string - not real PII, just a constant every
 * company's canary entity is derived from. Safe to hardcode: the point is
 * to prove the hash-compute -> DB-lookup -> confidence-check pipeline is
 * alive, not to protect a secret.
 */
export const CANARY_VALUE = 'PII_SHIELD_SYNTHETIC_CANARY_V1';
export const CANARY_ENTITY_TYPE = 'canary';
const CANARY_CONFIDENCE = 100;

@Injectable()
export class HealthCheckService {
  private readonly logger = new Logger(HealthCheckService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registers this company's canary entity if it isn't already there.
   * Idempotent (upsert on the same unique constraint every other entity
   * uses) and cheap - safe to call before every check.
   */
  private async ensureCanaryRegistered(company: Company): Promise<void> {
    const entityHash = computeEntityHash(CANARY_VALUE, company.entitySalt);
    await this.prisma.sensitiveEntity.upsert({
      where: {
        companyId_entityHash_entityType: {
          companyId: company.id,
          entityHash,
          entityType: CANARY_ENTITY_TYPE,
        },
      },
      update: {},
      create: {
        companyId: company.id,
        entityHash,
        entityType: CANARY_ENTITY_TYPE,
        confidence: CANARY_CONFIDENCE,
      },
    });
  }

  /**
   * Recomputes the canary hash fresh and confirms it's still found - proves
   * hashing, the entity table, and the DB connection are all alive end to
   * end. Deliberately does NOT touch a real AI provider site (no login
   * automation against ChatGPT/Claude on a schedule - see BUILD_LOG for
   * why), so this does not prove the browser extension itself is loaded in
   * a live tab, only that the backend half of the pipeline is healthy.
   */
  async runCheck(company: Company) {
    try {
      await this.ensureCanaryRegistered(company);
      const entityHash = computeEntityHash(CANARY_VALUE, company.entitySalt);
      const found = await this.prisma.sensitiveEntity.findUnique({
        where: {
          companyId_entityHash_entityType: {
            companyId: company.id,
            entityHash,
            entityType: CANARY_ENTITY_TYPE,
          },
        },
      });
      const success = !!found && found.confidence >= CANARY_CONFIDENCE;
      const result = await this.prisma.healthCheck.create({
        data: {
          companyId: company.id,
          success,
          detail: success ? null : 'Canary entity not found or below expected confidence after upsert',
        },
      });
      return result;
    } catch (err) {
      const result = await this.prisma.healthCheck.create({
        data: {
          companyId: company.id,
          success: false,
          detail: err instanceof Error ? err.message : String(err),
        },
      });
      return result;
    }
  }

  async getLatest(companyId: string) {
    return this.prisma.healthCheck.findFirst({
      where: { companyId },
      orderBy: { ranAt: 'desc' },
    });
  }

  /** Runs the synthetic check for every active company, hourly. */
  @Cron(CronExpression.EVERY_HOUR)
  async runForAllCompanies(): Promise<void> {
    const companies = await this.prisma.company.findMany({ where: { status: 'active' } });
    for (const company of companies) {
      try {
        await this.runCheck(company);
      } catch (err) {
        this.logger.error(`Health check failed for company ${company.id}`, err instanceof Error ? err.stack : err);
      }
    }
  }
}
