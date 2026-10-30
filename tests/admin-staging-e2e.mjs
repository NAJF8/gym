import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const STAGING_URL = "https://alasas-fit-staging.web.app";
const STAGING_WORKER = "https://alasas-fit-member-auth-staging.coffee101.workers.dev";
const PRODUCTION_WORKER = "https://alasas-fit-member-auth.coffee101.workers.dev";
const OUTPUT_DIR = join(process.cwd(), "output", "screenshots");
const storageState = process.env.PW_STORAGE_STATE || undefined;
const interactive = process.env.PW_INTERACTIVE === "1";
const requireAuth = process.env.PW_REQUIRE_AUTH === "1";
const captureStorageState = process.env.PW_CAPTURE_STORAGE_STATE || join(process.cwd(), "output", "playwright-staging-auth.json");

await mkdir(OUTPUT_DIR, { recursive: true });
const browser = await chromium.launch({ headless: !interactive });
const consoleErrors = [];
const networkErrors = [];
const seenUrls = new Set();

try {
  const context = await browser.newContext({
    storageState,
    locale: "ar-IQ",
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("request", request => seenUrls.add(request.url()));
  page.on("response", response => { if (response.status() >= 400 && !response.url().includes("/v1/admin/management/")) networkErrors.push(`${response.status()} ${response.url()}`); });

  console.log("=== Admin unauthenticated gate, desktop ===");
  await page.goto(`${STAGING_URL}/admin/`, { waitUntil: "networkidle" });
  await page.screenshot({ path: join(OUTPUT_DIR, "07-admin-staging-desktop.png"), fullPage: true });
  if (await page.locator(".admin-google-button").count() === 0 && !storageState) throw new Error("Admin Google login gate is missing");
  const unauthorized = await context.request.post(`${STAGING_WORKER}/v1/admin/management/list`, { headers: { origin: STAGING_URL, "content-type": "application/json" }, data: {} });
  console.log("Unauthenticated admin list status:", unauthorized.status());
  if (unauthorized.status() !== 401) throw new Error(`Expected unauthenticated admin list to return 401, got ${unauthorized.status()}`);

  console.log("=== Admin responsive gate, mobile ===");
  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(`${STAGING_URL}/admin/`, { waitUntil: "networkidle" });
  const overflow = await mobile.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  await mobile.screenshot({ path: join(OUTPUT_DIR, "08-admin-staging-mobile.png"), fullPage: true });
  console.log("Mobile dimensions:", overflow);
  if (overflow.scrollWidth > overflow.clientWidth + 1) throw new Error("Admin mobile page has horizontal overflow");

  if (storageState) {
    console.log("=== Authenticated admin management ===");
    await page.goto(`${STAGING_URL}/admin/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    const body = await page.locator("body").innerText();
    if (requireAuth && !body.includes("Team & Access") && !body.includes("المدراء والصلاحيات")) throw new Error("Authenticated storage state did not reach Team & Access");
    await page.screenshot({ path: join(OUTPUT_DIR, "09-admin-staging-management.png"), fullPage: true });
    console.log("Authenticated management visible:", body.includes("Team & Access") || body.includes("المدراء والصلاحيات"));
  } else if (interactive) {
    console.log("Complete Google sign-in in the visible browser using the existing authorized account; waiting for Team & Access...");
    await page.waitForFunction(() => {
      const body = document.body.innerText;
      return body.includes("Team & Access") || body.includes("المدراء والصلاحيات");
    }, { timeout: 180000 });
    await context.storageState({ path: captureStorageState });
    console.log("Saved Playwright storage state:", captureStorageState);
  } else {
    console.log("Google sign-in was not executed: set PW_INTERACTIVE=1, complete Google sign-in in the visible browser, and the script will save a Playwright storage state.");
  }

  const productionRequests = [...seenUrls].filter(url => url.startsWith(PRODUCTION_WORKER));
  if (productionRequests.length) throw new Error(`Production Worker requested by Staging UI: ${productionRequests.join(", ")}`);
  console.log(JSON.stringify({ consoleErrors, networkErrors, productionRequests, stagingWorkerObserved: [...seenUrls].some(url => url.startsWith(STAGING_WORKER)) }));
} finally {
  await browser.close();
}
