/**
 * Drives the real admin console (via `npm run dev`, port 5173) against a
 * real running backend, in a real headless Chromium - not a unit test with
 * mocked API calls. Prerequisites (not started by this script):
 *   - backend running on http://localhost:3000 with a known
 *     ADMIN_BOOTSTRAP_SECRET (passed as an env var to this script)
 *   - `npm run dev` running in this package on port 5173
 * Run with: ADMIN_BOOTSTRAP_SECRET=... npm run verify
 */
import { chromium } from 'playwright';

const ADMIN_SECRET = process.env.ADMIN_BOOTSTRAP_SECRET;
const APP_URL = 'http://localhost:5173';

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on('pageerror', (err) => console.log('[page error]', err));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[console error]', msg.text());
  });

  await page.goto(APP_URL);

  // --- Step 1: company details ---
  await page.getByLabel('כתובת שרת ה-backend').fill('http://localhost:3000');
  await page.getByLabel('קוד הפעלה מספק השירות').fill(ADMIN_SECRET);
  await page.getByLabel('שם החברה').fill('Manual Verify Co');
  await page.getByRole('button', { name: 'המשך' }).click();
  await page.waitForSelector('text=סוג מקור הנתונים');
  log('step 1 (company details) OK');

  // --- Step 2: connect source ---
  await page.selectOption('select', 'csv');
  await page.getByRole('button', { name: 'צור חיבור' }).click();
  await page.waitForSelector('text=בדוק חיבור');
  log('step 2 (connector created) OK');
  await page.getByRole('button', { name: 'המשך', exact: true }).last().click();
  await page.waitForSelector('text=ממתין לסנכרון הראשוני');
  log('step 3 (initial sync screen) OK');

  // --- Step 3: skip sync (no real connector running for this manual check) ---
  await page.getByRole('button', { name: 'דלג בינתיים' }).click();
  await page.waitForSelector('text=ההקמה הושלמה');
  log('step 4 (done screen) OK');

  const apiKeyText = await page.locator('code').first().textContent();
  assert(apiKeyText && apiKeyText.length > 10, 'api key should be displayed on done screen');

  await page.getByRole('button', { name: 'לכניסה למערכת הניהול' }).click();
  await page.waitForSelector('text=לוח בקרה');
  log('entered main app shell OK');

  // --- Dashboard: should show empty state (no employees/connectors data flowing yet, wait actually connector exists but no employees) ---
  await page.waitForTimeout(500);
  const dashboardText = await page.locator('main').textContent();
  log(`dashboard shows: ${dashboardText?.slice(0, 200)}`);

  // --- Employees page: add one employee ---
  await page.getByRole('link', { name: 'עובדים' }).click();
  await page.waitForSelector('text=הוספת עובד בודד');
  await page.locator('input[type=email]').first().fill('verify@manual-check.test');
  await page.getByRole('button', { name: 'הוסף' }).click();
  await page.waitForSelector('text=קוד התקנה לעובד');
  log('employee added OK');
  await page.waitForTimeout(500);
  const employeesTableText = await page.locator('table').textContent();
  assert(employeesTableText?.includes('verify@manual-check.test'), 'new employee should appear in table');
  assert(employeesTableText?.includes('לא הותקן עדיין'), 'new employee should show not_installed status');
  log('employee status shown correctly OK');

  // --- Settings page: toggle a type and save ---
  await page.getByRole('link', { name: 'הגדרות רגישות' }).click();
  await page.waitForSelector('text=סוגי מידע פעילים');
  const idCheckbox = page.locator('label:has-text("ת.ז") input[type=checkbox]');
  await idCheckbox.uncheck();
  await page.getByRole('button', { name: 'שמור הגדרות' }).click();
  await page.waitForSelector('text=נשמר בהצלחה');
  log('settings saved OK');

  await page.reload();
  await page.waitForSelector('text=סוגי מידע פעילים');
  const idCheckboxAfterReload = page.locator('label:has-text("ת.ז") input[type=checkbox]');
  assert(!(await idCheckboxAfterReload.isChecked()), 'disabled entity type should persist after reload');
  log('settings persisted after reload OK');

  await browser.close();
  log('ALL MANUAL VERIFICATION CHECKS PASSED');
}

main().catch((err) => {
  console.error('FAILED', err);
  process.exit(1);
});
