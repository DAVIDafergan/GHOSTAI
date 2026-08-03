import { ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

const ENTITY_TYPES = ['name', 'id_number', 'case_number', 'amount', 'email', 'phone'] as const;

export class UpdateSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  confidenceThreshold?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(0)
  @IsIn(ENTITY_TYPES, { each: true })
  enabledEntityTypes?: string[];
}
