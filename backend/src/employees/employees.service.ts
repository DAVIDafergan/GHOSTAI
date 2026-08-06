import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Company, Employee } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { generateSecret, hashSecret } from '../common/crypto/hashing.util';

const INACTIVE_AFTER_DAYS = 30;

/** "not_installed" | "active" | "inactive" | "disabled" - spec 6.5 employee table statuses. */
function computeEmployeeStatus(employee: Employee): string {
  if (employee.disabledAt) return 'disabled';
  if (!employee.activatedAt) return 'not_installed';
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - INACTIVE_AFTER_DAYS);
  if (employee.lastActiveAt && employee.lastActiveAt < cutoff) return 'inactive';
  return 'active';
}

@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(company: Company, email: string, name?: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await this.prisma.employee.findUnique({
      where: { companyId_email: { companyId: company.id, email: normalizedEmail } },
    });
    if (existing) {
      throw new ConflictException('Employee with this email already exists');
    }
    const extensionKey = generateSecret();
    const employee = await this.prisma.employee.create({
      data: {
        companyId: company.id,
        email: normalizedEmail,
        name: name?.trim() || undefined,
        extensionKeyHash: hashSecret(extensionKey),
      },
    });
    // extensionKey is returned exactly once at creation time; only its hash is persisted.
    return { employee, extensionKey };
  }

  async list(companyId: string) {
    const [employees, blockCounts] = await Promise.all([
      this.prisma.employee.findMany({ where: { companyId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.auditLog.groupBy({
        by: ['employeeId'],
        where: { companyId, eventType: 'blocked' },
        _count: { _all: true },
      }),
    ]);
    const blockCountByEmployee = new Map(blockCounts.map((b) => [b.employeeId, b._count._all]));
    return employees.map((e) => ({
      id: e.id,
      name: e.name,
      email: e.email,
      status: computeEmployeeStatus(e),
      createdAt: e.createdAt,
      lastActiveAt: e.lastActiveAt,
      blockCount: blockCountByEmployee.get(e.id) ?? 0,
    }));
  }

  async getOne(company: Company, employeeId: string) {
    const employee = await this.getOwned(company, employeeId);
    const blockCount = await this.prisma.auditLog.count({
      where: { companyId: company.id, employeeId, eventType: 'blocked' },
    });
    return {
      id: employee.id,
      name: employee.name,
      email: employee.email,
      status: computeEmployeeStatus(employee),
      createdAt: employee.createdAt,
      lastActiveAt: employee.lastActiveAt,
      blockCount,
    };
  }

  private async getOwned(company: Company, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId: company.id },
    });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }
    return employee;
  }

  async disable(company: Company, employeeId: string) {
    await this.getOwned(company, employeeId);
    return this.prisma.employee.update({
      where: { id: employeeId },
      data: { disabledAt: new Date() },
    });
  }
}
