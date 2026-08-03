import { Injectable, NotFoundException } from '@nestjs/common';
import type { Company } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IngestEntitiesDto } from './dto/ingest-entities.dto';

@Injectable()
export class EntitiesService {
  constructor(private readonly prisma: PrismaService) {}

  async ingestBatch(company: Company, dto: IngestEntitiesDto) {
    if (dto.connectorId) {
      const connector = await this.prisma.connector.findFirst({
        where: { id: dto.connectorId, companyId: company.id },
      });
      if (!connector) {
        throw new NotFoundException('Connector not found');
      }
    }

    const seenAt = new Date();
    let ingested = 0;
    for (const e of dto.entities) {
      await this.prisma.sensitiveEntity.upsert({
        where: {
          companyId_entityHash_entityType: {
            companyId: company.id,
            entityHash: e.entityHash,
            entityType: e.entityType,
          },
        },
        update: {
          confidence: e.confidence,
          seenAt,
          connectorId: dto.connectorId ?? undefined,
        },
        create: {
          companyId: company.id,
          entityHash: e.entityHash,
          entityType: e.entityType,
          confidence: e.confidence,
          connectorId: dto.connectorId,
          seenAt,
        },
      });
      ingested++;
    }
    return { ingested };
  }

  async list(companyId: string, cursor: string | undefined, limit: number) {
    const items = await this.prisma.sensitiveEntity.findMany({
      where: { companyId },
      orderBy: { id: 'asc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    return {
      entities: page.map((e) => ({
        entityHash: e.entityHash,
        entityType: e.entityType,
        confidence: e.confidence,
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }
}
