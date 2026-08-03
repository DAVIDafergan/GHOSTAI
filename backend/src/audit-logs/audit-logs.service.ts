import { Injectable } from '@nestjs/common';
import type { Company, Employee } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  create(employee: Employee, eventType: string, entityType?: string) {
    return this.prisma.auditLog.create({
      data: {
        companyId: employee.companyId,
        employeeId: employee.id,
        eventType,
        entityType,
      },
    });
  }

  async list(
    company: Company,
    options: { cursor?: string; limit: number; employeeId?: string; entityType?: string },
  ) {
    const items = await this.prisma.auditLog.findMany({
      where: {
        companyId: company.id,
        ...(options.employeeId ? { employeeId: options.employeeId } : {}),
        ...(options.entityType ? { entityType: options.entityType } : {}),
      },
      include: { employee: { select: { email: true } } },
      orderBy: { id: 'desc' },
      take: options.limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > options.limit;
    const page = hasMore ? items.slice(0, options.limit) : items;
    return {
      logs: page.map((log) => ({
        id: log.id,
        employeeEmail: log.employee.email,
        eventType: log.eventType,
        entityType: log.entityType,
        createdAt: log.createdAt,
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }
}
