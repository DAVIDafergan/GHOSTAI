import { detectFileKind } from './fileTextExtractor';

function makeFile(name: string): File {
  return new File([], name);
}

// extractText() itself is deliberately not unit-tested here: mammoth and
// xlsx resolve to different entry points under Jest's plain Node
// environment vs. the real extension's browser bundle (esbuild picks each
// package's "browser" field when bundling for platform: 'browser') - a
// Jest-only test would exercise a different code path than what actually
// ships and could give false confidence. Real extraction (all three
// formats, including pdf.js's browser-only worker) is covered by the
// "file upload" tests in e2e/extension.spec.ts against the real built
// extension in a real browser instead.
describe('detectFileKind', () => {
  it.each([
    ['report.pdf', 'pdf'],
    ['REPORT.PDF', 'pdf'],
    ['contract.docx', 'docx'],
    ['data.xlsx', 'xlsx'],
    ['legacy.xls', 'xlsx'],
  ] as const)('detects %s as %s', (name, kind) => {
    expect(detectFileKind(makeFile(name))).toBe(kind);
  });

  it.each(['image.png', 'notes.txt', 'archive.zip', 'noextension'])(
    'returns null for unsupported file %s',
    (name) => {
      expect(detectFileKind(makeFile(name))).toBeNull();
    },
  );
});
