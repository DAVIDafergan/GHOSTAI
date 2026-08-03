import { IsIn } from 'class-validator';

export const CONNECTOR_SOURCE_TYPES = ['postgres', 'csv', 'salesforce', 'generic_api'] as const;

export class CreateConnectorDto {
  @IsIn(CONNECTOR_SOURCE_TYPES)
  sourceType: string;
}
