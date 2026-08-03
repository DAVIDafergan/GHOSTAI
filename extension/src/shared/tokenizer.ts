import { computeEntityHash, normalizeValue } from './hashing';
import { detectStructuredCandidates, generateNGramCandidates } from './detectors';

export interface TokenMappingEntry {
  token: string;
  entityType: string;
  rawValue: string;
}

/**
 * Persists per-tab (in memory only, never written to disk) so the same
 * real-world entity always maps to the same token across a whole
 * conversation - both within one message (spec 6.6: repeated entity gets one
 * token) and across later messages/responses that might reference it again.
 * Cleared when the tab/page is torn down.
 */
export class TokenStore {
  private byKey = new Map<string, TokenMappingEntry>();
  private byToken = new Map<string, TokenMappingEntry>();
  private counters: Record<string, number> = {};

  getOrCreateToken(entityType: string, dedupeKey: string, rawValue: string): string {
    const existing = this.byKey.get(dedupeKey);
    if (existing) return existing.token;
    const n = (this.counters[entityType] = (this.counters[entityType] ?? 0) + 1);
    const token = `[${entityType.toUpperCase()}_${n}]`;
    const entry: TokenMappingEntry = { token, entityType, rawValue };
    this.byKey.set(dedupeKey, entry);
    this.byToken.set(token, entry);
    return token;
  }

  findByToken(token: string): TokenMappingEntry | undefined {
    return this.byToken.get(token);
  }

  allTokens(): TokenMappingEntry[] {
    return Array.from(this.byToken.values());
  }
}

interface CandidateSpan {
  start: number;
  end: number;
  entityType: string;
  dedupeKey: string;
  rawValue: string;
}

function resolveOverlaps(spans: CandidateSpan[]): CandidateSpan[] {
  // Longer spans win (so "Avner Cohen" as a whole beats "Avner" alone),
  // ties broken by earlier start; then greedily keep non-overlapping spans.
  // Tokens are only assigned afterwards, for the spans that survive this
  // step - otherwise a discarded shorter overlap would still consume a
  // token number and leave an orphaned, never-sent entry in the store.
  const sorted = [...spans].sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const accepted: CandidateSpan[] = [];
  for (const span of sorted) {
    const overlaps = accepted.some((a) => span.start < a.end && a.start < span.end);
    if (!overlaps) accepted.push(span);
  }
  return accepted.sort((a, b) => a.start - b.start);
}

export interface EntityIndexEntry {
  confidence: number;
}

/** key: `${entityType}:${entityHash}` */
export type EntityIndex = Map<string, EntityIndexEntry>;

export interface TokenizeResult {
  tokenizedText: string;
  hiddenCount: number;
  hiddenEntityTypes: string[];
  failSafe: boolean;
}

const NGRAM_YIELD_EVERY = 200;

export async function tokenizeText(
  text: string,
  store: TokenStore,
  options:
    | { failSafe: true }
    | {
        failSafe: false;
        entityIndex: EntityIndex;
        companySalt: string;
        confidenceThreshold: number;
        enabledEntityTypes?: string[];
      },
): Promise<TokenizeResult> {
  const spans: CandidateSpan[] = [];
  const structured = detectStructuredCandidates(text);
  const isEnabled = (entityType: string) =>
    options.failSafe || !options.enabledEntityTypes || options.enabledEntityTypes.includes(entityType);

  for (const cand of structured) {
    if (cand.entityType === 'id_number' && cand.confidence < 50) {
      continue; // failed checksum: never block, per spec 6.6
    }
    if (!isEnabled(cand.entityType)) continue;

    if (options.failSafe) {
      // No company list to compare against - block unconditionally as a
      // conservative fallback (spec 6.6: "never send with zero checking").
      spans.push({
        start: cand.start,
        end: cand.end,
        entityType: cand.entityType,
        dedupeKey: `local:${cand.entityType}:${normalizeValue(cand.value)}`,
        rawValue: cand.value,
      });
      continue;
    }

    const hash = await computeEntityHash(cand.value, options.companySalt);
    const known = options.entityIndex.get(`${cand.entityType}:${hash}`);
    if (known && known.confidence >= options.confidenceThreshold) {
      spans.push({
        start: cand.start,
        end: cand.end,
        entityType: cand.entityType,
        dedupeKey: `${cand.entityType}:${hash}`,
        rawValue: cand.value,
      });
    }
  }

  if (!options.failSafe) {
    const structuredRanges = structured.map((c) => [c.start, c.end] as const);
    let i = 0;
    for (const ngram of generateNGramCandidates(text)) {
      i++;
      if (i % NGRAM_YIELD_EVERY === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (structuredRanges.some(([s, e]) => ngram.start < e && s < ngram.end)) continue;

      for (const entityType of ['name', 'case_number'] as const) {
        if (!isEnabled(entityType)) continue;
        const hash = await computeEntityHash(ngram.value, options.companySalt);
        const known = options.entityIndex.get(`${entityType}:${hash}`);
        if (known && known.confidence >= options.confidenceThreshold) {
          spans.push({
            start: ngram.start,
            end: ngram.end,
            entityType,
            dedupeKey: `${entityType}:${hash}`,
            rawValue: ngram.value,
          });
        }
      }
    }
  }

  const resolved = resolveOverlaps(spans).map((span) => ({
    ...span,
    token: store.getOrCreateToken(span.entityType, span.dedupeKey, span.rawValue),
  }));

  let tokenizedText = text;
  for (const span of [...resolved].sort((a, b) => b.start - a.start)) {
    tokenizedText = tokenizedText.slice(0, span.start) + span.token + tokenizedText.slice(span.end);
  }

  return {
    tokenizedText,
    hiddenCount: resolved.length,
    hiddenEntityTypes: resolved.map((s) => s.entityType),
    failSafe: options.failSafe,
  };
}

/** Replaces any of this session's known tokens found in AI-provider output
 * with the original raw value the user typed (spec: response comes back
 * with real values, provider never saw them). */
export function detokenizeText(text: string, store: TokenStore): string {
  let result = text;
  for (const entry of store.allTokens()) {
    result = result.split(entry.token).join(entry.rawValue);
  }
  return result;
}
