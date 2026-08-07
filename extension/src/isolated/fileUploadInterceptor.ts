import { TokenStore, tokenizeText } from '../shared/tokenizer';
import { detectFileKind, extractText } from './fileTextExtractor';
import { showFileScanDialog, showFileScanFailedDialog } from './fileScanDialog';
import type { EntityStoreState } from './entityStore';

/**
 * Files that have already been scanned and approved for send (either
 * clean, or the user explicitly chose "continue anyway"). Needed because
 * approving a file means re-dispatching the same File object in a fresh
 * event so the page's own upload logic actually runs it - which would
 * otherwise trigger our own listener again, infinitely. A WeakSet doesn't
 * leak: once nothing else references the File (tab navigates, GC'd), the
 * entry goes with it.
 */
const approvedFiles = new WeakSet<File>();

function reportFileAuditEvent(
  store: EntityStoreState,
  eventType: 'blocked' | 'user_override',
  entityTypes: string[],
): void {
  if (!store.backendUrl || !store.extensionKey) return;
  for (const entityType of entityTypes) {
    fetch(`${store.backendUrl}/audit-logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-extension-key': store.extensionKey },
      body: JSON.stringify({ eventType, entityType, platform: location.hostname }),
    }).catch(() => undefined);
  }
}

/** Returns true if the file should proceed (clean, or user approved it). */
async function scanOneFile(file: File, getStore: () => EntityStoreState): Promise<boolean> {
  const store = getStore();
  let text: string;
  try {
    text = await extractText(file);
  } catch (err) {
    console.error('[Nistar][isolated] file text extraction failed for', file.name, err instanceof Error ? err.message : err);
    return showFileScanFailedDialog({
      fileName: file.name,
      reason: err instanceof Error ? err.message : 'שגיאה לא ידועה',
    });
  }

  // Disposable, per-scan TokenStore - a file's matches never get sent
  // anywhere (we only ever detect, never substitute file content), so
  // there's no reason for them to share the conversation's real token map.
  const throwawayStore = new TokenStore();
  const result = store.failSafe
    ? await tokenizeText(text, throwawayStore, { failSafe: true })
    : await tokenizeText(text, throwawayStore, {
        failSafe: false,
        entityIndex: store.entityIndex,
        companySalt: store.companySalt as string,
        confidenceThreshold: store.confidenceThreshold,
        enabledEntityTypes: store.enabledEntityTypes,
      });

  console.log('[Nistar][isolated] file scan result for', file.name, {
    hiddenCount: result.hiddenCount,
    hiddenEntityTypes: result.hiddenEntityTypes,
    failSafe: result.failSafe,
  });

  if (result.hiddenCount === 0) return true;

  const proceed = await showFileScanDialog({
    fileName: file.name,
    hiddenCount: result.hiddenCount,
    hiddenEntityTypes: result.hiddenEntityTypes,
  });
  reportFileAuditEvent(store, proceed ? 'user_override' : 'blocked', result.hiddenEntityTypes);
  return proceed;
}

/** All files must be approved (clean or user-confirmed) for the batch to proceed. */
async function scanFiles(files: File[], getStore: () => EntityStoreState): Promise<boolean> {
  for (const file of files) {
    const ok = await scanOneFile(file, getStore);
    if (!ok) return false;
  }
  return true;
}

function isFileInput(target: EventTarget | null): target is HTMLInputElement {
  return target instanceof HTMLInputElement && target.type === 'file';
}

/**
 * Only PDF/DOCX/XLSX/XLS (whatever detectFileKind recognizes) are ever
 * this feature's concern. Everything else - images, plain text, zips,
 * anything - was never in scope and must be completely invisible to this
 * feature: not scanned, not blocked, no "couldn't verify" dialog either.
 * Filtering *before* deciding whether to intercept at all (not inside the
 * scan step) is what makes that true - an unsupported file's extractText()
 * throwing "Unsupported file type" is a real error, but only meaningful
 * for a file we actually meant to scan; it must never reach that code
 * path in the first place for a file outside the allowlist.
 */
function needsScanning(files: File[]): File[] {
  return files.filter((f) => detectFileKind(f) !== null && !approvedFiles.has(f));
}

function handleFileInputChange(e: Event, getStore: () => EntityStoreState): void {
  const input = e.target;
  if (!isFileInput(input)) return;
  const files = input.files ? Array.from(input.files) : [];
  if (files.length === 0) return;

  const toScan = needsScanning(files);
  if (toScan.length === 0) return; // nothing here is our concern - let the browser handle it entirely normally

  e.preventDefault();
  e.stopImmediatePropagation();

  scanFiles(toScan, getStore).then((allApproved) => {
    if (!allApproved) return; // cancelled - input just keeps its current (unsent) selection
    // Replay the FULL original selection, not just the subset we scanned -
    // any unsupported files riding alongside a scanned one must go through
    // unmodified too, exactly as if this feature never touched them.
    files.forEach((f) => approvedFiles.add(f));
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  });
}

function handleDrop(e: DragEvent, getStore: () => EntityStoreState): void {
  const dt = e.dataTransfer;
  if (!dt || dt.files.length === 0) return;
  const files = Array.from(dt.files);

  const toScan = needsScanning(files);
  if (toScan.length === 0) return;

  e.preventDefault();
  e.stopImmediatePropagation();

  const target = e.target;
  scanFiles(toScan, getStore).then((allApproved) => {
    if (!allApproved || !target) return;
    files.forEach((f) => approvedFiles.add(f));
    const newDt = new DataTransfer();
    files.forEach((f) => newDt.items.add(f));
    target.dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: newDt }),
    );
  });
}

/**
 * Catches a file upload at the moment the user picks/drops it - before it
 * ever becomes a FormData body inside content-main.ts's patched fetch/XHR
 * (which, unlike text, has no reliable access to the original File object
 * once it's been serialized into multipart form data). Registered in the
 * isolated world (not MAIN): file `change`/`drop` are plain DOM events, no
 * page-JS access needed to observe them, and this way the extracted text
 * (which can be large) and the entity index it's matched against never
 * need to cross the MAIN/isolated postMessage boundary at all.
 */
export function initFileUploadInterceptor(getStore: () => EntityStoreState): void {
  document.addEventListener('change', (e) => handleFileInputChange(e, getStore), true);
  document.addEventListener('drop', (e) => handleDrop(e as DragEvent, getStore), true);
}
