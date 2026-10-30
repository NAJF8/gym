import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const managementClient = await readFile(new URL("../src/adminManagement.ts", import.meta.url), "utf8");
const ui = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
const memberPinClient = await readFile(new URL("../src/memberPin.ts", import.meta.url), "utf8");
const imageUploadClient = await readFile(new URL("../src/imageUpload.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../worker/src/index.ts", import.meta.url), "utf8");
const invitations = await readFile(new URL("../worker/src/invitations.ts", import.meta.url), "utf8");

test("admin management client requires an explicit environment endpoint", () => {
  assert.match(managementClient, /VITE_PIN_SERVICE_ENDPOINT/);
  assert.doesNotMatch(managementClient, /alasas-fit-member-auth\.coffee101\.workers\.dev/);
  assert.match(managementClient, /خدمة إدارة المدراء غير مهيأة لهذا الإصدار/);
  assert.match(managementClient, /عنوان Worker وCORS/);
});

test("member PIN and image clients do not silently fall back to Production", () => {
  assert.doesNotMatch(memberPinClient, /alasas-fit-member-auth\.coffee101\.workers\.dev/);
  assert.doesNotMatch(imageUploadClient, /alasas-fit-member-auth\.coffee101\.workers\.dev/);
  assert.match(memberPinClient, /VITE_PIN_SERVICE_ENDPOINT/);
  assert.match(imageUploadClient, /VITE_PIN_SERVICE_ENDPOINT/);
});

test("admin management UI distinguishes loading, error, and empty states", () => {
  const page = ui.slice(ui.indexOf("function AdminManagementPage()"), ui.indexOf("function ProfilePage"));
  assert.match(page, /useState\(true\)/);
  assert.match(page, /aria-busy=\{loading\}/);
  assert.match(page, /تعذر تحميل قائمة المدراء/);
  assert.match(page, /إعادة المحاولة/);
  assert.match(page, /error \? .*تعذر تحميل قائمة المدراء/s);
});

test("management routes keep CORS and server-side Google-admin checks explicit", () => {
  assert.match(worker, /if \(origin && !allowedOrigins\(env\)\.includes\(origin\)\) return json\(\{ error: "CORS_ORIGIN_DENIED" \}, 403/);
  assert.match(worker, /if \(request\.method === "OPTIONS"\) return new Response\(null, \{ status: 204/);
  assert.match(worker, /user\.emailVerified !== true/);
  assert.match(worker, /providerId === "google\.com"/);
  assert.match(worker, /actor\?\.role !== ['"]SUPER_ADMIN['"]/);
  assert.match(worker, /function ensureDatabaseBinding/);
  assert.match(worker, /if \(!env\.PIN_DB && env\.DB\) env\.PIN_DB = env\.DB/);
});

test("GitHub-backed print image routes exclude COACH", () => {
  assert.match(worker, /async function uploadPrintImage[\s\S]*actor\?\.role !== "SUPER_ADMIN" && actor\?\.role !== "MANAGER"/);
  assert.match(worker, /async function imageDeploymentStatus[\s\S]*actor\?\.role !== "SUPER_ADMIN" && actor\?\.role !== "MANAGER"/);
});

test("invitation cancellation is exact-match, pending-only, audited, and idempotent", () => {
  assert.match(worker, /action === ['"]cancel['"]/);
  assert.match(worker, /validInvitationRole\(body\.role\)/);
  assert.match(worker, /cancelInvitation\(env\.PIN_DB/);
  assert.match(worker, /INVITATION_CANCEL_INVALID/);
  assert.match(worker, /invitation_id AS invitationId/);
  assert.match(invitations, /status = 'PENDING'/);
  assert.match(invitations, /INVITE_CANCELLED/);
  assert.match(invitations, /idempotent: true/);
});

test("worker errors expose a safe reason and never echo internal error codes", () => {
  assert.match(worker, /const clientErrors: Record<string, string>/);
  assert.match(worker, /body\.reason = code/);
  assert.doesNotMatch(worker, /code:\s*code/);
  assert.match(worker, /INVITATION_EXPIRED: .*انتهت صلاحية الدعوة/);
  assert.match(worker, /INVITATION_APPLY_RETRYABLE: .*لم تكتمل مزامنة الدعوة/);
});
