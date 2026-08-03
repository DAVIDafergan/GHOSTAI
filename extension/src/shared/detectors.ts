import { isValidIsraeliId } from './idChecksum';

export interface Candidate {
  value: string;
  entityType: 'id_number' | 'email' | 'phone' | 'amount';
  start: number;
  end: number;
  /** Regex-only confidence, before any hash-list comparison (spec 6.6: an
   * ID-shaped number that fails the checksum should be logged low-confidence,
   * never blocked). */
  confidence: number;
}

const ID_RE = /\b\d{9}\b|\b\d{1,2}-\d{7}-\d\b/g;
const EMAIL_RE = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;
const PHONE_RE = /\b(?:\+972-?|0)(?:[23489]|5[0-9])-?\d{7}\b/g;
const AMOUNT_RE =
  /(?:₪\s?\d[\d,]*(?:\.\d+)?|\$\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:ש"ח|שקל(?:ים)?|NIS|USD|₪))/g;

function findAll(text: string, re: RegExp, entityType: Candidate['entityType'], confidence: number): Candidate[] {
  const results: Candidate[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(re.source, re.flags);
  while ((match = regex.exec(text)) !== null) {
    results.push({
      value: match[0],
      entityType,
      start: match.index,
      end: match.index + match[0].length,
      confidence,
    });
    if (match[0].length === 0) regex.lastIndex++; // avoid infinite loop on zero-width matches
  }
  return results;
}

export function detectStructuredCandidates(text: string): Candidate[] {
  const idCandidates = findAll(text, ID_RE, 'id_number', 100).map((c) => ({
    ...c,
    // spec 6.6: a number shaped like an ID but failing the check digit
    // should not be blocked, only logged at low confidence.
    confidence: isValidIsraeliId(c.value.replace(/-/g, '')) ? 100 : 20,
  }));

  return [
    ...idCandidates,
    ...findAll(text, EMAIL_RE, 'email', 100),
    ...findAll(text, PHONE_RE, 'phone', 100),
    ...findAll(text, AMOUNT_RE, 'amount', 90),
  ].sort((a, b) => a.start - b.start);
}

export interface NameCandidate {
  value: string;
  start: number;
  end: number;
}

const WORD_RE = /[\p{L}][\p{L}'-]*/gu; // matches Hebrew and Latin letter runs alike

/**
 * Generates sliding-window word n-grams (1-4 words) as candidate
 * name/case-number phrases. This - not language-specific NER - is the
 * primary mechanism for catching a company's own known entities in either
 * Hebrew or English: each candidate is only ever acted on if its hash
 * matches the company's fetched entity list, so over-generation here is
 * cheap and safe.
 */
export function* generateNGramCandidates(text: string, maxWords = 4): Generator<NameCandidate> {
  const words: { value: string; start: number; end: number }[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(WORD_RE.source, WORD_RE.flags);
  while ((match = regex.exec(text)) !== null) {
    words.push({ value: match[0], start: match.index, end: match.index + match[0].length });
  }

  for (let n = 1; n <= maxWords; n++) {
    for (let i = 0; i + n <= words.length; i++) {
      const span = words.slice(i, i + n);
      yield {
        value: text.slice(span[0].start, span[span.length - 1].end),
        start: span[0].start,
        end: span[span.length - 1].end,
      };
    }
  }
}
