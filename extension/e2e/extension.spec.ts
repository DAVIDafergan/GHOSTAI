import { test, expect, chromium } from '@playwright/test';
import { createHmac } from 'crypto';
import { ChildProcess, spawn } from 'child_process';
import path from 'path';
import { config as loadDotenv } from 'dotenv';

const EXTENSION_PATH = path.resolve(__dirname, '../dist');
const BACKEND_DIR = path.resolve(__dirname, '../../backend');
loadDotenv({ path: path.resolve(BACKEND_DIR, '.env') });

const BACKEND_PORT = 3097;
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;
const MOCK_PORT = 4500;
const MOCK_URL = `http://localhost:${MOCK_PORT}`;
const SUPER_ADMIN_USERNAME = process.env.SUPER_ADMIN_USERNAME as string;
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD as string;

function normalizeValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function computeEntityHash(value: string, salt: string): string {
  return createHmac('sha256', salt).update(normalizeValue(value)).digest('hex');
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server not ready at ${url} within ${timeoutMs}ms`);
}

let backendProcess: ChildProcess;
let mockServerProcess: ChildProcess;

test.beforeAll(async () => {
  // Spawning `npx ts-node ...` orphans the actual long-running process once
  // npx's own wrapper exits, so killing the returned child does nothing
  // (reproduced: leaked backend processes across repeated test runs).
  // Spawning node directly with `-r ts-node/register` avoids the extra
  // process hop entirely.
  backendProcess = spawn(
    process.execPath,
    ['-r', 'ts-node/register', '-r', 'tsconfig-paths/register', 'src/main.ts'],
    {
      cwd: BACKEND_DIR,
      env: { ...process.env, PORT: String(BACKEND_PORT) },
      stdio: 'pipe',
    },
  );
  backendProcess.stdout?.on('data', (d) => process.stdout.write(`[backend] ${d}`));
  backendProcess.stderr?.on('data', (d) => process.stderr.write(`[backend] ${d}`));

  mockServerProcess = spawn('node', [path.resolve(__dirname, 'mock-provider-server.mjs')], {
    env: { ...process.env, PORT: String(MOCK_PORT) },
    stdio: 'pipe',
  });
  mockServerProcess.stdout?.on('data', (d) => process.stdout.write(`[mock] ${d}`));
  mockServerProcess.stderr?.on('data', (d) => process.stderr.write(`[mock] ${d}`));

  await Promise.all([waitForServer(`${BACKEND_URL}/`, 60000), waitForServer(`${MOCK_URL}/`, 15000)]);
});

test.afterAll(() => {
  backendProcess?.kill();
  mockServerProcess?.kill();
});

test('a known company name and id number are tokenized before leaving the browser, and detokenized in the rendered response', async () => {
  // --- seed the backend with one known "customer" (as the connector would) ---
  const companyRes = await fetch(`${BACKEND_URL}/admin/companies`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-username': SUPER_ADMIN_USERNAME, 'x-admin-password': SUPER_ADMIN_PASSWORD },
    body: JSON.stringify({ name: 'Extension E2E Test Co' }),
  });
  expect(companyRes.status).toBe(201);
  const company = (await companyRes.json()) as { id: string; apiKey: string };

  const meRes = await fetch(`${BACKEND_URL}/companies/me`, { headers: { 'x-api-key': company.apiKey } });
  const me = (await meRes.json()) as { entitySalt: string };

  const NAME = 'Avner Cohen';
  const ID_NUMBER = '123456782'; // valid Israeli id check digit
  await fetch(`${BACKEND_URL}/entities/batch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': company.apiKey },
    body: JSON.stringify({
      entities: [
        { entityHash: computeEntityHash(NAME, me.entitySalt), entityType: 'name', confidence: 100 },
        { entityHash: computeEntityHash(ID_NUMBER, me.entitySalt), entityType: 'id_number', confidence: 100 },
      ],
    }),
  });

  const employeeRes = await fetch(`${BACKEND_URL}/employees`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': company.apiKey },
    body: JSON.stringify({ email: 'e2e@extension-test.test' }),
  });
  const employee = (await employeeRes.json()) as { extensionKey: string };

  // --- load the real unpacked extension in a real Chromium instance ---
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
  });

  let [background] = context.serviceWorkers();
  if (!background) background = await context.waitForEvent('serviceworker');
  const extensionId = background.url().split('/')[2];

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.fill('input >> nth=0', BACKEND_URL);
  await popup.fill('input >> nth=1', employee.extensionKey);
  await popup.click('button[type=submit]');
  await expect(popup.locator('text=מחובר בהצלחה')).toBeVisible({ timeout: 10000 });
  await popup.close();

  const page = await context.newPage();
  const consoleErrors: string[] = [];
  // The mock page has no favicon route, so the browser's own resource-load
  // 404 for it is expected noise (verified to be the only console error
  // ever seen against this mock page) - everything else should be clean.
  const KNOWN_NOISE = 'Failed to load resource: the server responded with a status of 404 (Not Found)';
  page.on('console', (msg) => {
    if (msg.type() === 'error' && msg.text() !== KNOWN_NOISE) consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));
  await page.goto(MOCK_URL);
  // give the content script's initial entity-store fetch a moment to complete
  await page.waitForTimeout(3000);

  // Catches regressions like the two found while building this: a crash
  // during content-script init that silently drops into fail-safe mode
  // (badge would show its warning), or a CORS failure fetching the entity
  // list (would show up as a console error here).
  expect(consoleErrors).toEqual([]);
  await expect(page.locator('#pii-shield-badge')).not.toContainText('לא ניתן לאמת');

  await page.fill('#input', `${NAME}, id ${ID_NUMBER}`);
  await page.click('#send');
  await page.waitForSelector('.response');

  const receivedRes = await fetch(`${MOCK_URL}/__received`);
  const received = (await receivedRes.json()) as { message: string }[];
  expect(received.length).toBeGreaterThan(0);
  const lastReceived = received[received.length - 1].message;

  // The core assertion: the raw PII never appeared in the network payload.
  expect(lastReceived).not.toContain(NAME);
  expect(lastReceived).not.toContain(ID_NUMBER);
  expect(lastReceived).toMatch(/\[NAME_\d+\]/);
  expect(lastReceived).toMatch(/\[ID_NUMBER_\d+\]/);

  // The response rendered on screen should have the real values restored.
  const renderedText = await page.locator('#messages').innerText();
  expect(renderedText).toContain(NAME);
  expect(renderedText).toContain(ID_NUMBER);

  await context.close();

  await fetch(`${BACKEND_URL}/admin/companies/${company.id}`, {
    method: 'DELETE',
    headers: { 'x-admin-username': SUPER_ADMIN_USERNAME, 'x-admin-password': SUPER_ADMIN_PASSWORD },
  });
});

test('file upload: a PDF containing a known name/id is blocked until the user chooses to proceed, a clean PDF uploads immediately', async () => {
  const companyRes = await fetch(`${BACKEND_URL}/admin/companies`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-username': SUPER_ADMIN_USERNAME, 'x-admin-password': SUPER_ADMIN_PASSWORD },
    body: JSON.stringify({ name: 'Extension E2E Test Co (file upload)' }),
  });
  const company = (await companyRes.json()) as { id: string; apiKey: string };

  const meRes = await fetch(`${BACKEND_URL}/companies/me`, { headers: { 'x-api-key': company.apiKey } });
  const me = (await meRes.json()) as { entitySalt: string };

  const NAME = 'Avner Cohen';
  const ID_NUMBER = '123456782';
  await fetch(`${BACKEND_URL}/entities/batch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': company.apiKey },
    body: JSON.stringify({
      entities: [
        { entityHash: computeEntityHash(NAME, me.entitySalt), entityType: 'name', confidence: 100 },
        { entityHash: computeEntityHash(ID_NUMBER, me.entitySalt), entityType: 'id_number', confidence: 100 },
      ],
    }),
  });

  const employeeRes = await fetch(`${BACKEND_URL}/employees`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': company.apiKey },
    body: JSON.stringify({ email: 'e2e-file-upload@extension-test.test' }),
  });
  const employee = (await employeeRes.json()) as { extensionKey: string };

  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
  });

  let [background] = context.serviceWorkers();
  if (!background) background = await context.waitForEvent('serviceworker');
  const extensionId = background.url().split('/')[2];

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.fill('input >> nth=0', BACKEND_URL);
  await popup.fill('input >> nth=1', employee.extensionKey);
  await popup.click('button[type=submit]');
  await expect(popup.locator('text=מחובר בהצלחה')).toBeVisible({ timeout: 10000 });
  await popup.close();

  const page = await context.newPage();
  await page.goto(`${MOCK_URL}/file-upload`);
  await page.waitForTimeout(3000);

  // --- 1. a PDF with a known name/id: dialog appears, cancel -> never uploaded ---
  await page.setInputFiles('#file-input', path.resolve(__dirname, 'fixtures/with-pii.pdf'));
  await expect(page.locator('text=נמצא מידע רגיש בקובץ')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('text=שמות: 1')).toBeVisible();
  await expect(page.locator('text=מספרי ת.ז.: 1')).toBeVisible();
  await page.click('text=בטל העלאה');
  await page.waitForTimeout(500);
  let uploads = (await (await fetch(`${MOCK_URL}/__received_uploads`)).json()) as { fileName: string }[];
  expect(uploads).toHaveLength(0);

  // --- 2. the same file again: dialog appears, proceed anyway -> uploaded, unmodified ---
  // Clearing first forces a genuine fresh 'change' event on re-selecting
  // the same path - otherwise the browser treats "select this exact file
  // again" as a no-op and never fires change a second time.
  await page.setInputFiles('#file-input', []);
  await page.setInputFiles('#file-input', path.resolve(__dirname, 'fixtures/with-pii.pdf'));
  await expect(page.locator('text=נמצא מידע רגיש בקובץ')).toBeVisible({ timeout: 10000 });
  await page.click('text=המשך בכל זאת');
  await page.waitForSelector('#status:has-text("uploaded")');
  uploads = (await (await fetch(`${MOCK_URL}/__received_uploads`)).json()) as { fileName: string }[];
  expect(uploads).toHaveLength(1);
  expect(uploads[0].fileName).toBe('with-pii.pdf');

  // --- 3. a clean PDF: no dialog at all, uploads immediately ---
  await page.setInputFiles('#file-input', path.resolve(__dirname, 'fixtures/clean.pdf'));
  await page.waitForSelector('#status:has-text("clean.pdf")', { timeout: 10000 });
  await expect(page.locator('text=נמצא מידע רגיש בקובץ')).not.toBeVisible();
  uploads = (await (await fetch(`${MOCK_URL}/__received_uploads`)).json()) as { fileName: string }[];
  expect(uploads).toHaveLength(2);
  expect(uploads[1].fileName).toBe('clean.pdf');

  // --- 4. same PII, but as DOCX and XLSX - proves detection+extraction isn't PDF-only ---
  await page.setInputFiles('#file-input', path.resolve(__dirname, 'fixtures/with-pii.docx'));
  await expect(page.locator('text=נמצא מידע רגיש בקובץ')).toBeVisible({ timeout: 10000 });
  await page.click('text=בטל העלאה');
  await page.waitForTimeout(500);

  await page.setInputFiles('#file-input', []);
  await page.setInputFiles('#file-input', path.resolve(__dirname, 'fixtures/with-pii.xlsx'));
  await expect(page.locator('text=נמצא מידע רגיש בקובץ')).toBeVisible({ timeout: 10000 });
  await page.click('text=בטל העלאה');
  await page.waitForTimeout(500);
  uploads = (await (await fetch(`${MOCK_URL}/__received_uploads`)).json()) as { fileName: string }[];
  expect(uploads).toHaveLength(2); // still 2 - both DOCX and XLSX were cancelled, neither uploaded

  await context.close();

  await fetch(`${BACKEND_URL}/admin/companies/${company.id}`, {
    method: 'DELETE',
    headers: { 'x-admin-username': SUPER_ADMIN_USERNAME, 'x-admin-password': SUPER_ADMIN_PASSWORD },
  });
});

test('same as above, but against a ProseMirror-style contentEditable composer (real ChatGPT/Claude structure, not a <textarea>) that blurs focus to <body> on send', async () => {
  // Regression test for a real bug found manually against the actual
  // chat.openai.com/claude.ai sites: getLiveInputText() previously only
  // checked document.activeElement plus querySelector('textarea') and
  // querySelector('[contenteditable="true"]'). On the real sites,
  // activeElement was <body> (focus moves away on send) and the composer's
  // contenteditable attribute is not literally the string "true" - so
  // nothing matched and the message was sent completely unmodified. This
  // mock page reproduces both of those conditions deliberately.
  const companyRes = await fetch(`${BACKEND_URL}/admin/companies`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-username': SUPER_ADMIN_USERNAME, 'x-admin-password': SUPER_ADMIN_PASSWORD },
    body: JSON.stringify({ name: 'Extension E2E Test Co (contentEditable)' }),
  });
  const company = (await companyRes.json()) as { id: string; apiKey: string };

  const meRes = await fetch(`${BACKEND_URL}/companies/me`, { headers: { 'x-api-key': company.apiKey } });
  const me = (await meRes.json()) as { entitySalt: string };

  const NAME = 'Avner Cohen';
  const ID_NUMBER = '123456782';
  await fetch(`${BACKEND_URL}/entities/batch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': company.apiKey },
    body: JSON.stringify({
      entities: [
        { entityHash: computeEntityHash(NAME, me.entitySalt), entityType: 'name', confidence: 100 },
        { entityHash: computeEntityHash(ID_NUMBER, me.entitySalt), entityType: 'id_number', confidence: 100 },
      ],
    }),
  });

  const employeeRes = await fetch(`${BACKEND_URL}/employees`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': company.apiKey },
    body: JSON.stringify({ email: 'e2e-contenteditable@extension-test.test' }),
  });
  const employee = (await employeeRes.json()) as { extensionKey: string };

  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
  });

  let [background] = context.serviceWorkers();
  if (!background) background = await context.waitForEvent('serviceworker');
  const extensionId = background.url().split('/')[2];

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.fill('input >> nth=0', BACKEND_URL);
  await popup.fill('input >> nth=1', employee.extensionKey);
  await popup.click('button[type=submit]');
  await expect(popup.locator('text=מחובר בהצלחה')).toBeVisible({ timeout: 10000 });
  await popup.close();

  const page = await context.newPage();
  await page.goto(`${MOCK_URL}/contenteditable`);
  await page.waitForTimeout(3000);

  await page.locator('#input').click();
  await page.keyboard.type(`${NAME}, id ${ID_NUMBER}`);
  await page.click('#send');
  await page.waitForSelector('.response');

  const receivedRes = await fetch(`${MOCK_URL}/__received`);
  const received = (await receivedRes.json()) as { message: string }[];
  const lastReceived = received[received.length - 1].message;

  // The core assertion: the raw PII never appeared in the network payload,
  // even though focus was on <body>, not the composer, when send fired.
  expect(lastReceived).not.toContain(NAME);
  expect(lastReceived).not.toContain(ID_NUMBER);
  expect(lastReceived).toMatch(/\[NAME_\d+\]/);
  expect(lastReceived).toMatch(/\[ID_NUMBER_\d+\]/);

  const renderedText = await page.locator('#messages').innerText();
  expect(renderedText).toContain(NAME);
  expect(renderedText).toContain(ID_NUMBER);

  await context.close();

  await fetch(`${BACKEND_URL}/admin/companies/${company.id}`, {
    method: 'DELETE',
    headers: { 'x-admin-username': SUPER_ADMIN_USERNAME, 'x-admin-password': SUPER_ADMIN_PASSWORD },
  });
});
