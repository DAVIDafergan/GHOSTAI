import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export const ENTITY_TYPES = ['name', 'id_number', 'case_number', 'amount', 'email', 'phone'] as const;

export class EntityHashDto {
  @IsString()
  entityHash: string;

  @IsIn(ENTITY_TYPES)
  entityType: string;

  @IsInt()
  @Min(0)
  @Max(100)
  confidence: number;
}

export class IngestEntitiesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => EntityHashDto)
  entities: EntityHashDto[];

  @IsOptional()
  @IsString()
  connectorId?: string;
}
