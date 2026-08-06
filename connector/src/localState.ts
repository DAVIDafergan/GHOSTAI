import { readFileSync, writeFileSync, existsSync } from 'fs';

/**
 * Local-only record of raw entity values this connector has ever seen or
 * been told about manually. Lives entirely on disk inside the customer's
 * own environment - NEVER sent to the central PII Shield backend, which by
 * design only ever receives entityHash values (see SECURITY.md). This is
 * what lets the admin console's "sensitive data" tab show real values and
 * let an admin exclude/add entities, without the central operator ever
 * seeing them.
 */
export type EntityOrigin = 'synced' | 'manual';

export interface LocalEntityRecord {
  value: string;
  entityType: string;
  firstSeenAt: string;
  lastSeenAt: string;
  origin: EntityOrigin;
  excluded: boolean;
}

interface LocalStateFile {
  entities: Record<string, LocalEntityRecord>;
}

function normalizeKey(value: string, entityType: string): string {
  return `${entityType}:${value.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

export interface EntityFilter {
  entityType?: string;
  search?: string;
  excluded?: boolean;
  /** ISO date string - only entities first seen on/after this date. */
  since?: string;
}

export class LocalStateStore {
  private data: LocalStateFile;

  constructor(private readonly filePath: string) {
    this.data = this.load();
  }

  private load(): LocalStateFile {
    if (!existsSync(this.filePath)) return { entities: {} };
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf-8')) as LocalStateFile;
      return parsed.entities ? parsed : { entities: {} };
    } catch {
      return { entities: {} };
    }
  }

  private save(): void {
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }

  /**
   * Called once per source row during a sync run. Refreshes lastSeenAt for
   * an already-known entity, or records a new one. Deliberately does NOT
   * touch the `excluded` flag - an admin's decision to stop tracking a
   * value must persist across syncs even while the value still exists at
   * the source, otherwise "remove from tracking" would be undone by the
   * very next sync.
   *
   * Does NOT write to disk immediately - a sync run can call this
   * thousands of times, and a synchronous full-file write per row would be
   * very slow. Call flush() once after a batch of these.
   */
  upsertSeen(value: string, entityType: string): void {
    const key = normalizeKey(value, entityType);
    const now = new Date().toISOString();
    const existing = this.data.entities[key];
    if (existing) {
      existing.lastSeenAt = now;
      existing.value = value;
    } else {
      this.data.entities[key] = {
        value,
        entityType,
        firstSeenAt: now,
        lastSeenAt: now,
        origin: 'synced',
        excluded: false,
      };
    }
  }

  /** Persists pending upsertSeen() calls to disk. */
  flush(): void {
    this.save();
  }

  addManual(value: string, entityType: string): LocalEntityRecord {
    const key = normalizeKey(value, entityType);
    const now = new Date().toISOString();
    const record: LocalEntityRecord = {
      value,
      entityType,
      firstSeenAt: now,
      lastSeenAt: now,
      origin: 'manual',
      excluded: false,
    };
    this.data.entities[key] = record;
    this.save();
    return record;
  }

  /** Only manual entities can be fully removed - a source-derived one would
   * just reappear on the next sync unless explicitly excluded instead. */
  removeManual(value: string, entityType: string): boolean {
    const key = normalizeKey(value, entityType);
    const existing = this.data.entities[key];
    if (!existing || existing.origin !== 'manual') return false;
    delete this.data.entities[key];
    this.save();
    return true;
  }

  setExcluded(value: string, entityType: string, excluded: boolean): LocalEntityRecord {
    const key = normalizeKey(value, entityType);
    const existing = this.data.entities[key];
    if (existing) {
      existing.excluded = excluded;
      this.save();
      return existing;
    }
    // Pre-emptive exclusion of a value not yet seen from the source is
    // still valid - record it so a future sync respects it immediately.
    const now = new Date().toISOString();
    const record: LocalEntityRecord = {
      value,
      entityType,
      firstSeenAt: now,
      lastSeenAt: now,
      origin: 'synced',
      excluded,
    };
    this.data.entities[key] = record;
    this.save();
    return record;
  }

  get(value: string, entityType: string): LocalEntityRecord | undefined {
    return this.data.entities[normalizeKey(value, entityType)];
  }

  list(filter: EntityFilter = {}): LocalEntityRecord[] {
    return Object.values(this.data.entities).filter((r) => {
      if (filter.entityType && r.entityType !== filter.entityType) return false;
      if (filter.excluded !== undefined && r.excluded !== filter.excluded) return false;
      if (filter.search && !r.value.toLowerCase().includes(filter.search.toLowerCase())) return false;
      if (filter.since && r.firstSeenAt < filter.since) return false;
      return true;
    });
  }

  /** Entities eligible to sync to the central backend this run. */
  activeEntities(): LocalEntityRecord[] {
    return Object.values(this.data.entities).filter((r) => !r.excluded);
  }
}
