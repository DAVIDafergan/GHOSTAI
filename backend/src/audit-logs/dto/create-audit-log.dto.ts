import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const AUDIT_EVENT_TYPES = ['blocked', 'allowed', 'user_override'] as const;
export const ENTITY_TYPES_FOR_AUDIT = ['name', 'id_number', 'case_number', 'amount', 'email', 'phone'] as const;

export class CreateAuditLogDto {
  @IsIn(AUDIT_EVENT_TYPES)
  eventType: string;

  @IsOptional()
  @IsIn(ENTITY_TYPES_FOR_AUDIT)
  entityType?: string;

  /** hostname of the AI site the event happened on, e.g. "chatgpt.com" */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  platform?: string;
}
