import { computeEntityHash } from './hashing';
import { EntityIndex, TokenStore, detokenizeText, tokenizeText } from './tokenizer';

const SALT = 'test-company-salt';

async function buildIndex(entries: { value: string; entityType: string; confidence?: number }[]): Promise<EntityIndex> {
  const index: EntityIndex = new Map();
  for (const e of entries) {
    const hash = await computeEntityHash(e.value, SALT);
    index.set(`${e.entityType}:${hash}`, { confidence: e.confidence ?? 100 });
  }
  return index;
}

describe('tokenizeText', () => {
  it('tokenizes a known name and a valid id number found in the company list', async () => {
    const entityIndex = await buildIndex([
      { value: 'Avner Cohen', entityType: 'name' },
      { value: '123456782', entityType: 'id_number' },
    ]);
    const store = new TokenStore();
    const result = await tokenizeText('Avner Cohen, ת.ז 123456782', store, {
      failSafe: false,
      entityIndex,
      companySalt: SALT,
      confidenceThreshold: 50,
    });

    expect(result.tokenizedText).toContain('[NAME_1]');
    expect(result.tokenizedText).toContain('[ID_NUMBER_1]');
    expect(result.tokenizedText).not.toContain('Avner Cohen');
    expect(result.tokenizedText).not.toContain('123456782');
    expect(result.hiddenCount).toBe(2);
    expect(result.failSafe).toBe(false);
  });

  it('gives repeated occurrences of the same entity the same token, not a new one each time', async () => {
    const entityIndex = await buildIndex([{ value: 'Avner Cohen', entityType: 'name' }]);
    const store = new TokenStore();
    const result = await tokenizeText('Avner Cohen said hi. Avner Cohen said bye.', store, {
      failSafe: false,
      entityIndex,
      companySalt: SALT,
      confidenceThreshold: 50,
    });
    const occurrences = result.tokenizedText.match(/\[NAME_1\]/g) ?? [];
    expect(occurrences).toHaveLength(2);
    expect(result.tokenizedText).not.toMatch(/\[NAME_2\]/);
  });

  it('does not tokenize a name that is not in the company list', async () => {
    const entityIndex = await buildIndex([{ value: 'Avner Cohen', entityType: 'name' }]);
    const store = new TokenStore();
    const result = await tokenizeText('Some Random Person', store, {
      failSafe: false,
      entityIndex,
      companySalt: SALT,
      confidenceThreshold: 50,
    });
    expect(result.hiddenCount).toBe(0);
    expect(result.tokenizedText).toBe('Some Random Person');
  });

  it('prefers the longer overlapping match ("Avner Cohen" over "Avner" alone)', async () => {
    const entityIndex = await buildIndex([
      { value: 'Avner Cohen', entityType: 'name' },
      { value: 'Avner', entityType: 'name' },
    ]);
    const store = new TokenStore();
    const result = await tokenizeText('Avner Cohen is here', store, {
      failSafe: false,
      entityIndex,
      companySalt: SALT,
      confidenceThreshold: 50,
    });
    expect(result.hiddenCount).toBe(1);
    expect(result.tokenizedText).toBe('[NAME_1] is here');
  });

  it('never blocks an id-shaped number that fails the check digit, even if present in a (bogus) index', async () => {
    const entityIndex = await buildIndex([{ value: '123456789', entityType: 'id_number' }]);
    const store = new TokenStore();
    const result = await tokenizeText('123456789', store, {
      failSafe: false,
      entityIndex,
      companySalt: SALT,
      confidenceThreshold: 50,
    });
    expect(result.hiddenCount).toBe(0);
  });

  it('handles Hebrew and English mixed in the same message', async () => {
    const entityIndex = await buildIndex([{ value: 'אבנר כהן', entityType: 'name' }]);
    const store = new TokenStore();
    const result = await tokenizeText('Please review אבנר כהן file today', store, {
      failSafe: false,
      entityIndex,
      companySalt: SALT,
      confidenceThreshold: 50,
    });
    expect(result.tokenizedText).toBe('Please review [NAME_1] file today');
  });

  it('respects enabledEntityTypes, skipping disabled types even when they match the list', async () => {
    const entityIndex = await buildIndex([
      { value: 'Avner Cohen', entityType: 'name' },
      { value: '123456782', entityType: 'id_number' },
    ]);
    const store = new TokenStore();
    const result = await tokenizeText('Avner Cohen, ת.ז 123456782', store, {
      failSafe: false,
      entityIndex,
      companySalt: SALT,
      confidenceThreshold: 50,
      enabledEntityTypes: ['name'], // id_number disabled
    });
    expect(result.tokenizedText).toBe('[NAME_1], ת.ז 123456782');
    expect(result.hiddenCount).toBe(1);
  });

  it('fail-safe mode blocks structured regex matches unconditionally, without a company list', async () => {
    const store = new TokenStore();
    const result = await tokenizeText('email me at someone@example.com about 123456782', store, {
      failSafe: true,
    });
    expect(result.failSafe).toBe(true);
    expect(result.tokenizedText).not.toContain('someone@example.com');
    expect(result.tokenizedText).not.toContain('123456782');
  });

  it('fail-safe mode does not attempt name detection (no list to check against)', async () => {
    const store = new TokenStore();
    const result = await tokenizeText('Avner Cohen called', store, { failSafe: true });
    expect(result.tokenizedText).toBe('Avner Cohen called');
    expect(result.hiddenCount).toBe(0);
  });

  it('re-tokenizing edited text (simulating a user edit after the fact) reflects the current content, not stale state', async () => {
    const entityIndex = await buildIndex([
      { value: 'Avner Cohen', entityType: 'name' },
      { value: 'Dana Levi', entityType: 'name' },
    ]);
    const store = new TokenStore();
    const first = await tokenizeText('Avner Cohen is the client', store, {
      failSafe: false,
      entityIndex,
      companySalt: SALT,
      confidenceThreshold: 50,
    });
    expect(first.tokenizedText).toBe('[NAME_1] is the client');

    // user deleted "Avner Cohen" and typed "Dana Levi" instead before sending
    const edited = await tokenizeText('Dana Levi is the client', store, {
      failSafe: false,
      entityIndex,
      companySalt: SALT,
      confidenceThreshold: 50,
    });
    expect(edited.tokenizedText).toBe('[NAME_2] is the client');
  });
});

describe('detokenizeText', () => {
  it('restores the original raw value the user typed wherever the token reappears', async () => {
    const entityIndex = await buildIndex([{ value: 'Avner Cohen', entityType: 'name' }]);
    const store = new TokenStore();
    await tokenizeText('Avner Cohen is the client', store, {
      failSafe: false,
      entityIndex,
      companySalt: SALT,
      confidenceThreshold: 50,
    });
    const aiResponse = 'According to our records, [NAME_1] has an open case.';
    expect(detokenizeText(aiResponse, store)).toBe('According to our records, Avner Cohen has an open case.');
  });
});
