import { Injectable } from '@nestjs/common';
import type { Company } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const INACTIVE_AFTER_DAYS = 30;
const HISTORY_DAYS = 30;

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
}
