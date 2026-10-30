import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const STAGING_URL = "https://alasas-fit-staging.web.app";
const STAGING_WORKER = "https://alasas-fit-member-auth-staging.coffee101.workers.dev";
const PRODUCTION_WORKER = "https://alasas-fit-member-auth.coffee101.workers.dev";
const OUTPUT_DIR = join(process.cwd(), "output", "playwright");
const storageState = process.env.PW_STORAGE_STATE || undefined;
const interactive = process.env.PW_INTERACTIVE === "1";
const requireAuth = process.env.PW_REQUIRE_AUTH === "1";
const cdpUrl = process.env.PW_CDP_URL || "";
const captureStorageState = process.env.PW_CAPTURE_STORAGE_STATE || join(process.cwd(), ".playwright", "staging-auth.json");

await mkdir(OUTPUT_DIR, { recursive: true });
const browser = cdpUrl
  ? await chromium.connectOverCDP(cdpUrl)
  : await chromium.launch({ headless: !interactive, ...(interactive ? { channel: "chrome" } : {}) });
const consoleErrors = [];
const networkErrors = [];
const seenUrls = new Set();

try {
  const context = cdpUrl && browser.contexts()[0]
    ? browser.contexts()[0]
    : await browser.newContext({
      storageState,
      locale: "ar-IQ",
      viewport: { width: 1280, height: 900 },
    });
  const page = context.pages().find(candidate => candidate.url().startsWith(STAGING_URL)) || await context.newPage();
  page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("request", request => seenUrls.add(request.url()));
  page.on("response", response => {
    if (response.status() >= 400 && !response.url().includes("/v1/admin/management/"))
      networkErrors.push(`${response.status()} ${response.url()}`);
  });

  await page.goto(`${STAGING_URL}/admin/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  try { await page.screenshot({ path: join(OUTPUT_DIR, "admin-staging-login.png"), fullPage: true, timeout: 10000 }); } catch { /* screenshot is diagnostic only */ }
  const teamButton = page.locator("button.nav-item").filter({ hasText: /المدراء والصلاحيات|Team & Access/ });
  await Promise.any([
    page.locator(".admin-google-button").waitFor({ state: "attached", timeout: 30000 }),
    teamButton.waitFor({ state: "attached", timeout: 30000 }),
  ]);
  const loginGatePresent = await page.locator(".admin-google-button").count() > 0;
  const adminShellPresent = await teamButton.count() > 0;
  if (!loginGatePresent && !adminShellPresent && !storageState)
    throw new Error("Admin Google login gate is missing");

  const unauthorized = await context.request.post(`${STAGING_WORKER}/v1/admin/management/list`, {
    headers: { origin: STAGING_URL, "content-type": "application/json" },
    data: {},
  });
  if (unauthorized.status() !== 401)
    throw new Error(`Expected unauthenticated admin list to return 401, got ${unauthorized.status()}`);
  console.log(JSON.stringify({ authenticated: false, unauthenticatedAdminListStatus: unauthorized.status(), productionRequests: [...seenUrls].filter(url => url.startsWith(PRODUCTION_WORKER)) }));

  if (storageState || interactive) {
    if (interactive && !storageState) {
      if (!(await teamButton.count())) {
        await page.locator(".admin-google-button").click();
        console.log("Complete Google sign-in in the visible browser with the approved Super Admin account; no invitations or roles will be changed.");
        await teamButton.waitFor({ state: "visible", timeout: 180000 });
      }
      await teamButton.click();
      await page.locator(".admin-management-page").waitFor({ state: "visible", timeout: 30000 });
      await mkdir(dirname(captureStorageState), { recursive: true });
      await context.storageState({ path: captureStorageState });
    }
    await page.locator(".admin-management-page").waitFor({ state: "visible", timeout: 30000 });
    await page.waitForFunction(() => document.body.innerText.includes("mohameadalhaear100@gmail.com") && document.body.innerText.includes("SUPER_ADMIN"), { timeout: 30000 });
    const body = await page.locator("body").innerText();
    if (!body.includes("mohameadalhaear100@gmail.com") || !body.includes("SUPER_ADMIN"))
      throw new Error("The live admin list did not prove the designated Super Admin role");
    const invitationRows = page.locator(".admin-management-page tbody tr");
    const invitationCount = await invitationRows.count();
    const pendingRows = invitationRows.filter({ hasText: "الدعوة معلقة" });
    const pendingCount = await pendingRows.count();
    if (requireAuth && invitationCount !== 5)
      throw new Error(`Expected five existing invitation/account rows, found ${invitationCount}`);
    await page.screenshot({ path: join(OUTPUT_DIR, "admin-staging-team-access.png"), fullPage: true });
    if (consoleErrors.length || networkErrors.length) throw new Error(`Browser errors: ${JSON.stringify({ consoleErrors, networkErrors })}`);
    console.log(JSON.stringify({ authenticated: true, invitationAccountRowCount: invitationCount, pendingInvitationCount: pendingCount, productionRequests: [...seenUrls].filter(url => url.startsWith(PRODUCTION_WORKER)) }));
  }

  const productionRequests = [...seenUrls].filter(url => url.startsWith(PRODUCTION_WORKER));
  if (productionRequests.length) throw new Error(`Staging UI requested Production Worker: ${productionRequests.join(", ")}`);
} finally {
  await browser.close();
}
