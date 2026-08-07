export type SupportedFileKind = 'pdf' | 'docx' | 'xlsx';

/**
 * By extension, not MIME type - browsers/OSes report inconsistent (or
 * empty) MIME types for these formats depending on platform, but the
 * extension the user themselves gave the file is reliable enough for this
 * purpose (worst case: an extension-spoofed file fails to parse below and
 * is treated as "couldn't verify," never as "silently skipped").
 */
export function detectFileKind(file: File): SupportedFileKind | null {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.docx')) return 'docx';
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return 'xlsx';
  return null;
}

let pdfWorkerConfigured = false;

async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  // Loaded on demand, not at module scope: pdf.js's ESM build uses
  // `import.meta.url` internally, which crashes under Jest's CJS
  // transform even just importing it, let alone running it under Node
  // with no `chrome.runtime` - deferring the import until a PDF is
  // actually being scanned keeps this file testable under Jest for the
  // DOCX/XLSX paths (see fileTextExtractor.spec.ts). Note this does NOT
  // reduce what content-isolated.js ships on every page load - esbuild's
  // IIFE output (required for a classic-script content script, see
  // scripts/build-content-scripts.mjs) has no code-splitting, so pdf.js's
  // bytes are still in the one file either way; the only real runtime
  // benefit is V8 not fully compiling this function body until it's
  // actually called (standard lazy-parsing behavior for any function, not
  // something specific to dynamic import).
  const pdfjsLib = await import('pdfjs-dist');
  if (!pdfWorkerConfigured) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('workers/pdf.worker.min.mjs');
    pdfWorkerConfigured = true;
  }
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pageTexts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pageTexts.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  return pageTexts.join('\n');
}

async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value;
}

/**
 * Every sheet, every cell, as CSV - simplest reliable way to get a flat
 * text representation of a workbook's actual data (which is what we're
 * scanning for, not layout/formatting) covering both .xlsx and legacy
 * binary .xls in one code path.
 */
async function extractXlsxText(buffer: ArrayBuffer): Promise<string> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(buffer, { type: 'array' });
  return workbook.SheetNames.map((name) => XLSX.utils.sheet_to_csv(workbook.Sheets[name])).join('\n');
}

/** Throws on failure - callers must treat that as "couldn't verify this file," never as "nothing found." */
export async function extractText(file: File): Promise<string> {
  const kind = detectFileKind(file);
  if (!kind) throw new Error(`Unsupported file type: ${file.name}`);
  const buffer = await file.arrayBuffer();
  switch (kind) {
    case 'pdf':
      return extractPdfText(buffer);
    case 'docx':
      return extractDocxText(buffer);
    case 'xlsx':
      return extractXlsxText(buffer);
  }
}
