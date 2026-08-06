import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocalStateStore } from './localState';

describe('LocalStateStore', () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pii-shield-state-'));
    filePath = join(dir, 'state.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('persists across instances once flushed (real file, not just in-memory)', () => {
    const store = new LocalStateStore(filePath);
    store.upsertSeen('Avner Cohen', 'name');
    store.flush();
    const reloaded = new LocalStateStore(filePath);
    expect(reloaded.list()).toHaveLength(1);
    expect(reloaded.list()[0].value).toBe('Avner Cohen');
  });

  it('exclusion survives being re-seen in a later sync (the actual point of tracking it locally)', () => {
    const store = new LocalStateStore(filePath);
    store.upsertSeen('Avner Cohen', 'name');
    store.setExcluded('Avner Cohen', 'name', true);
    // simulate the next sync run re-seeing the same source row
    store.upsertSeen('Avner Cohen', 'name');
    expect(store.list()[0].excluded).toBe(true);
    expect(store.activeEntities()).toHaveLength(0);
  });

  it('can pre-emptively exclude a value never seen from the source yet', () => {
    const store = new LocalStateStore(filePath);
    store.setExcluded('Future Person', 'name', true);
    store.upsertSeen('Future Person', 'name');
    expect(store.list()[0].excluded).toBe(true);
  });

  it('only removes manual entities, never source-derived ones', () => {
    const store = new LocalStateStore(filePath);
    store.upsertSeen('Synced Person', 'name');
    store.addManual('Manual Person', 'name');

    expect(store.removeManual('Synced Person', 'name')).toBe(false);
    expect(store.removeManual('Manual Person', 'name')).toBe(true);

    const remaining = store.list();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].value).toBe('Synced Person');
  });

  it('filters by entityType, excluded status, and case-insensitive search', () => {
    const store = new LocalStateStore(filePath);
    store.upsertSeen('Avner Cohen', 'name');
    store.upsertSeen('123456782', 'id_number');
    store.setExcluded('123456782', 'id_number', true);

    expect(store.list({ entityType: 'name' })).toHaveLength(1);
    expect(store.list({ excluded: true })).toHaveLength(1);
    expect(store.list({ excluded: false })).toHaveLength(1);
    expect(store.list({ search: 'avner' })).toHaveLength(1);
    expect(store.list({ search: 'nobody' })).toHaveLength(0);
  });

  it('filters by first-seen date', () => {
    const store = new LocalStateStore(filePath);
    store.upsertSeen('Old Person', 'name');
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    expect(store.list({ since: future })).toHaveLength(0);
    expect(store.list({ since: new Date(0).toISOString() })).toHaveLength(1);
  });

  it('normalizes casing/whitespace so the same real-world value never gets two records', () => {
    const store = new LocalStateStore(filePath);
    store.upsertSeen('Avner  Cohen', 'name');
    store.upsertSeen('avner cohen', 'name');
    expect(store.list()).toHaveLength(1);
  });

  it('activeEntities excludes only entities marked excluded', () => {
    const store = new LocalStateStore(filePath);
    store.upsertSeen('A', 'name');
    store.upsertSeen('B', 'name');
    store.setExcluded('A', 'name', true);
    expect(store.activeEntities().map((e) => e.value)).toEqual(['B']);
  });
});
