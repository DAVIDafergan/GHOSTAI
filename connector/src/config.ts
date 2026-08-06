import { readFileSync } from 'fs';
import { resolve } from 'path';

export type EntityType = 'name' | 'id_number' | 'case_number' | 'amount' | 'email' | 'phone';

export interface FieldMapping {
  column: string;
  entityType: EntityType;
}

export interface PostgresSourceConfig {
  type: 'postgres';
  connectionString: string;
  table: string;
  fieldMappings: FieldMapping[];
}

export interface CsvSourceConfig {
  type: 'csv';
  filePath: string;
  fieldMappings: FieldMapping[];
}

export type SourceConfig = PostgresSourceConfig | CsvSourceConfig;

export interface ConnectorConfig {
  backendUrl: string;
  apiKey: string;
  connectorId?: string;
  schedule?: string;
  source: SourceConfig;
  /** Path to the local (never synced centrally) file tracking raw entity
   * values, first/last-seen times, and admin exclusions/manual additions.
   * Defaults to connector-state.json in the current working directory. */
  stateFilePath?: string;
  /** If set, `daemon` mode also starts the local HTTP API (see server.ts)
   * on this port, for the admin console's "sensitive data" tab to query
   * directly. Not set = API disabled, daemon just runs scheduled syncs. */
  apiPort?: number;
}

const VALID_ENTITY_TYPES: EntityType[] = ['name', 'id_number', 'case_number', 'amount', 'email', 'phone'];

export function loadConfig(path: string): ConnectorConfig {
  const raw = readFileSync(path, 'utf-8');
  const config = JSON.parse(raw) as ConnectorConfig;
  validateConfig(config);
  return config;
}

export function resolveStateFilePath(config: ConnectorConfig): string {
  return resolve(config.stateFilePath ?? './connector-state.json');
}

export function validateConfig(config: ConnectorConfig): void {
  if (!config.backendUrl) throw new Error('config.backendUrl is required');
  if (!config.apiKey) throw new Error('config.apiKey is required');
  if (!config.source) throw new Error('config.source is required');
  if (config.source.type !== 'postgres' && config.source.type !== 'csv') {
    throw new Error(`Unsupported source.type: ${(config.source as SourceConfig).type}`);
  }
  if (!config.source.fieldMappings?.length) {
    throw new Error('config.source.fieldMappings must be a non-empty array');
  }
  for (const mapping of config.source.fieldMappings) {
    if (!VALID_ENTITY_TYPES.includes(mapping.entityType)) {
      throw new Error(`Invalid entityType "${mapping.entityType}" for column "${mapping.column}"`);
    }
  }
}
