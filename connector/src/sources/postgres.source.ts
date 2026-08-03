import { Pool } from 'pg';
import { PostgresSourceConfig } from '../config';
import { ExtractedValue } from './types';
import { assertSafeIdentifier } from './identifier';

export async function* extractFromPostgres(config: PostgresSourceConfig): AsyncGenerator<ExtractedValue[]> {
  assertSafeIdentifier(config.table);
  for (const mapping of config.fieldMappings) {
    assertSafeIdentifier(mapping.column);
  }

  const pool = new Pool({ connectionString: config.connectionString });
  try {
    const columns = config.fieldMappings.map((m) => `"${m.column}"`).join(', ');
    const result = await pool.query(`SELECT ${columns} FROM "${config.table}"`);
    for (const row of result.rows) {
      const values: ExtractedValue[] = [];
      for (const mapping of config.fieldMappings) {
        const raw = row[mapping.column];
        if (raw === null || raw === undefined || raw === '') continue;
        values.push({ value: String(raw), entityType: mapping.entityType });
      }
      if (values.length) yield values;
    }
  } finally {
    await pool.end();
  }
}
