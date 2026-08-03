import { createReadStream } from 'fs';
import { parse } from 'csv-parse';
import { CsvSourceConfig } from '../config';
import { ExtractedValue } from './types';

export async function* extractFromCsv(config: CsvSourceConfig): AsyncGenerator<ExtractedValue[]> {
  const parser = createReadStream(config.filePath).pipe(parse({ columns: true, trim: true }));
  for await (const row of parser as AsyncIterable<Record<string, string>>) {
    const values: ExtractedValue[] = [];
    for (const mapping of config.fieldMappings) {
      const raw = row[mapping.column];
      if (raw === null || raw === undefined || raw === '') continue;
      values.push({ value: String(raw), entityType: mapping.entityType });
    }
    if (values.length) yield values;
  }
}
