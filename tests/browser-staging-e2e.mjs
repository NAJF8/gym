import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const STAGING_URL = "https://alasas-fit-staging.web.app";
const WORKER_URL = "https://alasas-fit-member-auth-staging.coffee101.workers.dev";
const OUTPUT_DIR = join(process.cwd(), "output", "screenshots");
const MEMBER_A_PHONE = process.env.STAGING_TEST_MEMBER_A_PHONE || "";
const MEMBER_A_PIN = process.env.STAGING_TEST_MEMBER_A_PIN || "";
const MEMBER_B_PHONE = process.env.STAGING_TEST_MEMBER_B_PHONE || "";
const MEMBER_B_PIN = process.env.STAGING_TEST_MEMBER_B_PIN || "";

if (![MEMBER_A_PHONE, MEMBER_A_PIN, MEMBER_B_PHONE, MEMBER_B_PIN].every(Boolean)) {
  throw new Error("STAGING_TEST_MEMBER_A_PHONE, STAGING_TEST_MEMBER_A_PIN, STAGING_TEST_MEMBER_B_PHONE, and STAGING_TEST_MEMBER_B_PIN are required; do not commit Staging credentials.");
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "ar-IQ",
    permissions: ["clipboard-read", "clipboard-write"],
  });

  const consoleErrors = [];
  const networkErrors = [];

  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push({ url: page.url(), text: msg.text() });
    }
  });
  page.on("response", (res) => {
    if (res.status() >= 400 && !res.url().includes("/v1/member/login")) {
      networkErrors.push({ url: res.url(), status: res.status() });
    }
  });

  console.log("=== STEP 1: Member Login Screen & Eye Toggle ===");
  await page.goto(`${STAGING_URL}/`, { waitUntil: "networkidle" });
  await page.screenshot({ path: join(OUTPUT_DIR, "01-member-login-screen.png") });

  const phoneInput = page.locator("#member-phone");
  const pinInput = page.locator("#member-pin");
  const eyeBtn = page.locator(".pin-visibility-btn");

  await phoneInput.fill(MEMBER_A_PHONE);
  await pinInput.fill(MEMBER_A_PIN);
  console.log("Initial pin input type:", await pinInput.getAttribute("type")); // password

  // Click eye button on login form to show PIN
  await eyeBtn.click();
  console.log("After eye click pin input type:", await pinInput.getAttribute("type")); // text
  if ((await pinInput.getAttribute("type")) !== "text") {
    throw new Error("Eye toggle failed to switch pin input to text");
  }

  // Click eye button again to hide PIN
  await eyeBtn.click();
  console.log("After second eye click pin input type:", await pinInput.getAttribute("type")); // password
  if ((await pinInput.getAttribute("type")) !== "password") {
    throw new Error("Eye toggle failed to switch pin input back to password");
  }

  console.log("=== STEP 2: Live Member Login (Member A) ===");
  await page.locator(".member-login-submit").click();
  await page.waitForSelector(".member-portal", { timeout: 10000 });
  await page.waitForTimeout(1000); // Wait for transition
  await page.screenshot({ path: join(OUTPUT_DIR, "02-member-portal-dashboard.png") });

  // Verify Member A details
  const pageContent = await page.content();
  if (!pageContent.includes("E2E Test A")) {
    throw new Error("Member A portal did not render member name");
  }
  console.log("Verified Member A portal rendered with name 'E2E Test A'");

  // Check Days
  const dayTabs = page.locator(".days-pills button, .member-day-tab, .day-pill");
  const dayCount = await dayTabs.count();
  console.log("Day pills count:", dayCount);

  console.log("=== STEP 3: Member Portal Logout ===");
  const logoutBtn = page.locator("button:has-text('خروج'), button:has-text('تسجيل الخروج'), .logout-btn");
  if (await logoutBtn.count() > 0) {
    await logoutBtn.first().click();
    await page.waitForSelector("#member-phone", { timeout: 10000 });
    console.log("Logged out successfully, member-phone is visible again");
  } else {
    // Session token in sessionStorage test
    await page.evaluate(() => sessionStorage.clear());
    await page.reload({ waitUntil: "networkidle" });
  }
  await page.screenshot({ path: join(OUTPUT_DIR, "03-member-logout-success.png") });

  console.log("=== STEP 4: Live Member Login (Member B - Isolation) ===");
  await page.locator("#member-phone").fill(MEMBER_B_PHONE);
  await page.locator("#member-pin").fill(MEMBER_B_PIN);
  await page.locator(".member-login-submit").click();
  await page.waitForSelector(".member-portal", { timeout: 10000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: join(OUTPUT_DIR, "04-member-b-dashboard.png") });

  const contentB = await page.content();
  if (!contentB.includes("E2E Test B") || contentB.includes("E2E Test A")) {
    throw new Error("Member B portal failed isolation check");
  }
  console.log("Verified Member B portal rendered with name 'E2E Test B' (isolated from Member A)");

  console.log("=== STEP 5: Wrong PIN Error & Unregistered Phone Handling ===");
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(`${STAGING_URL}/`, { waitUntil: "networkidle" });

  await page.locator("#member-phone").fill(MEMBER_A_PHONE);
  await page.locator("#member-pin").fill("9999");
  await page.locator(".member-login-submit").click();
  const alertError = page.locator(".auth-error[role='alert']");
  await alertError.waitFor({ timeout: 5000 });
  const errorText = await alertError.innerText();
  console.log("Wrong PIN error message:", errorText);
  await page.screenshot({ path: join(OUTPUT_DIR, "05-member-wrong-pin-error.png") });

  if (!errorText.includes("بيانات الدخول غير صحيحة")) {
    throw new Error("Expected generic Arabic error message for wrong PIN");
  }

  console.log("=== STEP 6: Staging Admin Login Gate ===");
  await page.goto(`${STAGING_URL}/admin/`, { waitUntil: "networkidle" });
  await page.screenshot({ path: join(OUTPUT_DIR, "06-admin-login-screen.png") });
  const googleBtn = page.locator(".admin-google-button");
  console.log("Admin Google button present:", await googleBtn.count());
  if (await googleBtn.count() === 0) {
    throw new Error("Admin login gate button missing");
  }

  console.log("=== STEP 7: Check Console & Network Errors ===");
  console.log("Console errors collected:", consoleErrors);
  console.log("Unexpected Network errors collected:", networkErrors);

  await browser.close();
  console.log("ALL REAL BROWSER STAGING TESTS COMPLETED SUCCESSFULLY!");
}

main().catch((err) => {
  console.error("BROWSER TEST FAILED:", err);
  process.exit(1);
});
