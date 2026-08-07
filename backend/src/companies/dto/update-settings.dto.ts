import { ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

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

  // Deliberately not @IsUrl() - that validator rejects localhost/private-IP
  // hosts by default (requires a TLD), which is exactly what most
  // connectors use (http://localhost:4100, http://192.168.x.x:4100). Just
  // sanity-check it looks like an http(s) URL.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(/^https?:\/\/.+/, { message: 'connectorAdminUrl must start with http:// or https://' })
  connectorAdminUrl?: string;
}
