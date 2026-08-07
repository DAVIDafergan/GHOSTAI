import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Company } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { computeEntityHash, generateSecret, hashSecret } from '../common/crypto/hashing.util';

/**
 * Fixed, non-secret marker string - not real PII, just a constant every
 * company's canary entity is derived from. Safe to hardcode: the point is
 * to prove the hash-compute -> DB-lookup -> confidence-check pipeline is
 * alive, not to protect a secret.
 */
export const CANARY_VALUE = 'PII_SHIELD_SYNTHETIC_CANARY_V1';
export const CANARY_ENTITY_TYPE = 'canary';
const CANARY_CONFIDENCE = 100;

const SYNTHETIC_COMPANY_NAME = '__synthetic_e2e_test_company__';
const SYNTHETIC_EMPLOYEE_EMAIL = 'synthetic-e2e@internal.nistar';
// How much simulated-block history to keep for the synthetic company - just
// enough to prove "blocked this month" stays non-zero without growing
// forever. This is disposable fixture data, never a real customer's.
const SYNTHETIC_AUDIT_LOG_RETENTION_DAYS = 7;
// Caps how many e2e_chain HealthCheck rows we keep, so the super-admin
// history graph has plenty of data points without the table growing
// unbounded (hourly runs -> ~720/month if uncapped).
const SYSTEM_HEALTH_HISTORY_RETENTION_COUNT = 500;

type ChainStepKey =
  | 'companyCreate'
  | 'employeeCreate'
  | 'blockSimulate'
  | 'auditVerify'
  | 'dashboardVerify'
  | 'cleanup';

interface ChainStepResult {
  key: ChainStepKey;
  success: boolean;
  detail?: string;
}

@Injectable()
export class HealthCheckService {
  private readonly logger = new Logger(HealthCheckService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboardService: DashboardService,
  ) {}

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
          kind: 'canary',
          detail: success ? null : 'Canary entity not found or below expected confidence after upsert',
        },
      });
      return result;
    } catch (err) {
      const result = await this.prisma.healthCheck.create({
        data: {
          companyId: company.id,
          success: false,
          kind: 'canary',
          detail: err instanceof Error ? err.message : String(err),
        },
      });
      return result;
    }
  }

  async getLatest(companyId: string) {
    return this.prisma.healthCheck.findFirst({
      where: { companyId, kind: 'canary' },
      orderBy: { ranAt: 'desc' },
    });
  }

  /** Runs the synthetic check for every active company, hourly. */
  @Cron(CronExpression.EVERY_HOUR)
  async runForAllCompanies(): Promise<void> {
    const companies = await this.prisma.company.findMany({ where: { status: 'active', isSynthetic: false } });
    for (const company of companies) {
      try {
        await this.runCheck(company);
      } catch (err) {
        this.logger.error(`Health check failed for company ${company.id}`, err instanceof Error ? err.stack : err);
      }
    }
    try {
      await this.runSystemE2ECheck();
    } catch (err) {
      this.logger.error('System-wide E2E health check crashed', err instanceof Error ? err.stack : err);
    }
  }

  /**
   * Idempotently finds (or creates, on first run) the single internal
   * company used only for the synthetic E2E chain below. Reused across
   * every run rather than recreated each time, so this doesn't spam the
   * company list with a new fake row every hour - `isSynthetic: true` keeps
   * it out of every real operator-facing list/aggregate regardless.
   */
  private async ensureSyntheticCompany(): Promise<Company> {
    const existing = await this.prisma.company.findFirst({ where: { isSynthetic: true } });
    if (existing) return existing;
    return this.prisma.company.create({
      data: {
        name: SYNTHETIC_COMPANY_NAME,
        apiKeyHash: hashSecret(generateSecret()), // never exposed; this company is never logged into
        isSynthetic: true,
      },
    });
  }

  private async ensureSyntheticEmployee(company: Company) {
    return this.prisma.employee.upsert({
      where: { companyId_email: { companyId: company.id, email: SYNTHETIC_EMPLOYEE_EMAIL } },
      update: { lastActiveAt: new Date() },
      create: {
        companyId: company.id,
        email: SYNTHETIC_EMPLOYEE_EMAIL,
        name: 'Synthetic E2E Test Employee',
        extensionKeyHash: hashSecret(generateSecret()), // never exposed; not a real installable key
        activatedAt: new Date(),
        lastActiveAt: new Date(),
      },
    });
  }

  /**
   * Full end-to-end synthetic chain, not just a hash lookup: creates (or
   * reuses) an isolated fake company, adds a fake employee, simulates a
   * block event, then verifies that event is actually queryable through
   * the same audit-log and dashboard-summary code paths a real admin
   * console uses - proving the whole pipeline, not just one link of it.
   * Never touches real customer data (see `isSynthetic` on Company).
   */
  async runSystemE2ECheck() {
    const steps: ChainStepResult[] = [];
    let company: Company | null = null;
    let employeeId: string | null = null;
    let createdLogId: string | null = null;

    try {
      company = await this.ensureSyntheticCompany();
      steps.push({ key: 'companyCreate', success: true });
    } catch (err) {
      steps.push({ key: 'companyCreate', success: false, detail: this.errorMessage(err) });
    }

    if (company) {
      try {
        const employee = await this.ensureSyntheticEmployee(company);
        employeeId = employee.id;
        steps.push({ key: 'employeeCreate', success: true });
      } catch (err) {
        steps.push({ key: 'employeeCreate', success: false, detail: this.errorMessage(err) });
      }
    } else {
      steps.push({ key: 'employeeCreate', success: false, detail: 'skipped - no synthetic company' });
    }

    if (company && employeeId) {
      try {
        const log = await this.prisma.auditLog.create({
          data: {
            companyId: company.id,
            employeeId,
            eventType: 'blocked',
            entityType: CANARY_ENTITY_TYPE,
            platform: 'synthetic-e2e-check',
          },
        });
        createdLogId = log.id;
        steps.push({ key: 'blockSimulate', success: true });
      } catch (err) {
        steps.push({ key: 'blockSimulate', success: false, detail: this.errorMessage(err) });
      }
    } else {
      steps.push({ key: 'blockSimulate', success: false, detail: 'skipped - no synthetic employee' });
    }

    if (company && createdLogId) {
      try {
        const found = await this.prisma.auditLog.findUnique({ where: { id: createdLogId } });
        const ok = !!found && found.eventType === 'blocked' && found.companyId === company.id;
        steps.push({ key: 'auditVerify', success: ok, detail: ok ? undefined : 'simulated block not found in audit log' });
      } catch (err) {
        steps.push({ key: 'auditVerify', success: false, detail: this.errorMessage(err) });
      }
    } else {
      steps.push({ key: 'auditVerify', success: false, detail: 'skipped - no simulated block to verify' });
    }

    if (company) {
      try {
        const summary = await this.dashboardService.getSummary(company);
        const ok = summary.blocksThisMonth >= 1;
        steps.push({
          key: 'dashboardVerify',
          success: ok,
          detail: ok ? undefined : `dashboard summary shows blocksThisMonth=${summary.blocksThisMonth}`,
        });
      } catch (err) {
        steps.push({ key: 'dashboardVerify', success: false, detail: this.errorMessage(err) });
      }
    } else {
      steps.push({ key: 'dashboardVerify', success: false, detail: 'skipped - no synthetic company' });
    }

    if (company) {
      try {
        await this.cleanupSyntheticData(company.id);
        steps.push({ key: 'cleanup', success: true });
      } catch (err) {
        steps.push({ key: 'cleanup', success: false, detail: this.errorMessage(err) });
      }
    } else {
      steps.push({ key: 'cleanup', success: false, detail: 'skipped - no synthetic company' });
    }

    const success = steps.every((s) => s.success);
    if (!company) {
      // Nothing to attach a HealthCheck row to (companyId is a required FK) -
      // the companyCreate step above already recorded the failure reason;
      // just log it loudly since this means the DB itself is unreachable.
      this.logger.error('System E2E health check aborted: could not create/find the synthetic company');
      return null;
    }

    const result = await this.prisma.healthCheck.create({
      data: {
        companyId: company.id,
        success,
        kind: 'e2e_chain',
        steps: steps as unknown as object,
        detail: success ? null : steps.find((s) => !s.success)?.detail ?? 'one or more chain steps failed',
      },
    });

    await this.pruneOldSystemHealthHistory();
    return result;
  }

  /** Prunes simulated audit-log rows older than the retention window, and
   * caps how many e2e_chain history rows are kept - this data is entirely
   * synthetic fixture data, never a real customer's, so an aggressive
   * bound is safe. */
  private async cleanupSyntheticData(companyId: string): Promise<void> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - SYNTHETIC_AUDIT_LOG_RETENTION_DAYS);
    await this.prisma.auditLog.deleteMany({ where: { companyId, createdAt: { lt: cutoff } } });
  }

  private async pruneOldSystemHealthHistory(): Promise<void> {
    const excess = await this.prisma.healthCheck.findMany({
      where: { kind: 'e2e_chain' },
      orderBy: { ranAt: 'desc' },
      skip: SYSTEM_HEALTH_HISTORY_RETENTION_COUNT,
      select: { id: true },
    });
    if (excess.length === 0) return;
    await this.prisma.healthCheck.deleteMany({ where: { id: { in: excess.map((e) => e.id) } } });
  }

  /** Recent system-wide E2E chain results, for the super-admin "System
   * Health" history view - most recent first. */
  async getSystemHistory(limit = 100) {
    return this.prisma.healthCheck.findMany({
      where: { kind: 'e2e_chain' },
      orderBy: { ranAt: 'desc' },
      take: limit,
    });
  }

  private errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
