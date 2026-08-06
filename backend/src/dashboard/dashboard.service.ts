import { Injectable } from '@nestjs/common';
import type { Company } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const INACTIVE_AFTER_DAYS = 30;
const HISTORY_DAYS = 30;
const ANOMALY_WINDOW_DAYS = 7;

// Thresholds are deliberately conservative (require both a relative *and* an
// absolute floor) - with few employees, "3x the median" is trivially true
// at near-zero volume (e.g. median 0, anyone with 1 block "exceeds" it),
// which would flag constantly on small/new companies. The absolute floor
// avoids that noise; the relative check is what the user asked for.
const HIGH_BLOCKS_MULTIPLIER = 3;
const MIN_BLOCKS_FOR_HIGH_BLOCKS_FLAG = 5;
const MIN_OVERRIDES_FOR_FLAG = 3; // "repeated" override attempts, not a one-off
const MIN_UNUSUAL_HOUR_BLOCKS_FOR_FLAG = 3;
// Outside this window (UTC) counts as "unusual hours." A known
// simplification - this doesn't account for each employee's own timezone,
// only the server's (Railway runs UTC) - worth revisiting per-company if
// this becomes noisy for a non-Israel-based customer.
const BUSINESS_HOURS_START_UTC = 6;
const BUSINESS_HOURS_END_UTC = 22;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(company: Company) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const historyStart = new Date(now);
    historyStart.setDate(historyStart.getDate() - HISTORY_DAYS);
    const inactiveCutoff = new Date(now);
    inactiveCutoff.setDate(inactiveCutoff.getDate() - INACTIVE_AFTER_DAYS);

    const [blocksThisMonth, employees, connectors, recentBlocks, entitiesCount] = await Promise.all([
      this.prisma.auditLog.count({
        where: { companyId: company.id, eventType: 'blocked', createdAt: { gte: monthStart } },
      }),
      this.prisma.employee.findMany({ where: { companyId: company.id } }),
      this.prisma.connector.findMany({ where: { companyId: company.id } }),
      this.prisma.auditLog.findMany({
        where: { companyId: company.id, eventType: 'blocked', createdAt: { gte: historyStart } },
        select: { createdAt: true },
      }),
      this.prisma.sensitiveEntity.count({ where: { companyId: company.id } }),
    ]);

    const activeEmployees = employees.filter(
      (e) => !e.disabledAt && e.lastActiveAt && e.lastActiveAt >= inactiveCutoff,
    ).length;

    const blocksByDay = new Map<string, number>();
    for (const log of recentBlocks) {
      const day = log.createdAt.toISOString().slice(0, 10);
      blocksByDay.set(day, (blocksByDay.get(day) ?? 0) + 1);
    }
    const blocksByDayArray = Array.from(blocksByDay.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      blocksThisMonth,
      totalEmployees: employees.length,
      activeEmployees,
      entitiesCount,
      connectors: connectors.map((c) => ({
        id: c.id,
        sourceType: c.sourceType,
        status: c.status,
        lastSyncAt: c.lastSyncAt,
      })),
      blocksByDay: blocksByDayArray,
    };
  }

  /**
   * Flags employees with a suspicious pattern this week: far more blocks
   * than their peers, repeated override attempts, or activity concentrated
   * in unusual hours. See threshold constants above for the exact reasoning
   * behind each cutoff.
   */
  async getAnomalies(company: Company) {
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - ANOMALY_WINDOW_DAYS);

    const [employees, logs] = await Promise.all([
      this.prisma.employee.findMany({ where: { companyId: company.id, disabledAt: null } }),
      this.prisma.auditLog.findMany({
        where: { companyId: company.id, createdAt: { gte: weekStart } },
        select: { employeeId: true, eventType: true, createdAt: true },
      }),
    ]);

    const blocksByEmployee = new Map<string, number>();
    const overridesByEmployee = new Map<string, number>();
    const unusualHourBlocksByEmployee = new Map<string, number>();

    for (const log of logs) {
      if (log.eventType === 'blocked') {
        blocksByEmployee.set(log.employeeId, (blocksByEmployee.get(log.employeeId) ?? 0) + 1);
        const hour = log.createdAt.getUTCHours();
        if (hour < BUSINESS_HOURS_START_UTC || hour >= BUSINESS_HOURS_END_UTC) {
          unusualHourBlocksByEmployee.set(log.employeeId, (unusualHourBlocksByEmployee.get(log.employeeId) ?? 0) + 1);
        }
      } else if (log.eventType === 'user_override') {
        overridesByEmployee.set(log.employeeId, (overridesByEmployee.get(log.employeeId) ?? 0) + 1);
      }
    }

    const results: {
      employeeId: string;
      name: string | null;
      email: string;
      blocksThisWeek: number;
      medianOfOthers: number;
      reasons: { type: string; detail: string }[];
    }[] = [];

    for (const employee of employees) {
      const blocksThisWeek = blocksByEmployee.get(employee.id) ?? 0;
      const overridesThisWeek = overridesByEmployee.get(employee.id) ?? 0;
      const unusualHourBlocks = unusualHourBlocksByEmployee.get(employee.id) ?? 0;

      const othersBlockCounts = employees
        .filter((e) => e.id !== employee.id)
        .map((e) => blocksByEmployee.get(e.id) ?? 0);
      const medianOfOthers = median(othersBlockCounts);

      const reasons: { type: string; detail: string }[] = [];
      if (
        blocksThisWeek >= MIN_BLOCKS_FOR_HIGH_BLOCKS_FLAG &&
        blocksThisWeek > medianOfOthers * HIGH_BLOCKS_MULTIPLIER
      ) {
        reasons.push({
          type: 'high_blocks',
          detail: `${blocksThisWeek} blocks this week vs a median of ${medianOfOthers} among other employees`,
        });
      }
      if (overridesThisWeek >= MIN_OVERRIDES_FOR_FLAG) {
        reasons.push({
          type: 'repeated_override',
          detail: `${overridesThisWeek} override attempts this week`,
        });
      }
      if (unusualHourBlocks >= MIN_UNUSUAL_HOUR_BLOCKS_FOR_FLAG) {
        reasons.push({
          type: 'unusual_hours',
          detail: `${unusualHourBlocks} blocks outside ${BUSINESS_HOURS_START_UTC}:00-${BUSINESS_HOURS_END_UTC}:00 UTC this week`,
        });
      }

      if (reasons.length > 0) {
        results.push({
          employeeId: employee.id,
          name: employee.name,
          email: employee.email,
          blocksThisWeek,
          medianOfOthers,
          reasons,
        });
      }
    }

    return { anomalies: results, windowDays: ANOMALY_WINDOW_DAYS };
  }
}
