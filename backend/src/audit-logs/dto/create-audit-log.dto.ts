import { IsIn, IsOptional } from 'class-validator';

export const AUDIT_EVENT_TYPES = ['blocked', 'allowed', 'user_override'] as const;
export const ENTITY_TYPES_FOR_AUDIT = ['name', 'id_number', 'case_number', 'amount', 'email', 'phone'] as const;

export class CreateAuditLogDto {
  @IsIn(AUDIT_EVENT_TYPES)
  eventType: string;

  @IsOptional()
  @IsIn(ENTITY_TYPES_FOR_AUDIT)
  entityType?: string;
}
