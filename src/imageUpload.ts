import { firebaseAuth } from "./firebase";

const endpoint = String(
  import.meta.env.VITE_IMAGE_UPLOAD_ENDPOINT ||
    import.meta.env.VITE_PIN_SERVICE_ENDPOINT ||
    (import.meta.env.PROD ? "https://alasas-fit-member-auth.coffee101.workers.dev" : ""),
).replace(/\/+$/, "");

export const imageUploadConfigured = /^https:\/\//i.test(endpoint) || /^http:\/\/localhost(?::\d+)?$/i.test(endpoint);

export type PrintImageSlot = "logo" | "coach" | "hall";

async function adminToken() {
  if (!firebaseAuth) throw new Error("Firebase غير مهيأ");
  await firebaseAuth.authStateReady();
  if (!firebaseAuth.currentUser) throw new Error("يجب تسجيل دخول مدير Google موثّق");
  return firebaseAuth.currentUser.getIdToken(true);
}

function base64(bytes: Uint8Array) {
  let result = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk)
    result += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunk, bytes.length)));
  return btoa(result);
}

export async function uploadPrintImage(slot: PrintImageSlot, file: File): Promise<{ path: string; commitSha: string }> {
  if (!imageUploadConfigured) throw new Error("رفع الصور غير مهيأ في Staging");
  const allowed = new Set(["image/png", "image/jpeg", "image/webp"]);
  if (!allowed.has(file.type)) throw new Error("يسمح فقط بـ PNG أو JPG أو WebP");
  if (file.size <= 0 || file.size > 8 * 1024 * 1024) throw new Error("حجم الصورة يجب أن يكون بين 1 بايت و8MB");
  const token = await adminToken();
  const body = { slot, fileName: file.name, contentType: file.type, content: base64(new Uint8Array(await file.arrayBuffer())) };
  const response = await fetch(`${endpoint}/v1/admin/image-upload`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({})) as { error?: string; path?: string; commitSha?: string };
  if (!response.ok || !result.path || !result.commitSha) throw new Error(result.error || "تعذر رفع الصورة إلى GitHub");
  return { path: result.path, commitSha: result.commitSha };
}

export async function waitForPrintImageDeployment(commitSha: string, path: string, onProgress?: (message: string) => void) {
  const token = await adminToken();
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(`${endpoint}/v1/admin/image-status`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ commitSha, path }),
    });
    const result = await response.json().catch(() => ({})) as { state?: string; deployedUrl?: string; error?: string };
    if (!response.ok) throw new Error(result.error || "تعذر التحقق من نشر الصورة");
    if (result.state === "deployed" && result.deployedUrl) return result.deployedUrl;
    if (result.state === "failed") throw new Error("فشل نشر الصورة على Staging؛ بقي الرابط القديم محفوظاً");
    onProgress?.(result.state === "queued" ? "الصورة في قائمة النشر…" : "جارٍ نشر الصورة على Staging…");
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
  }
  throw new Error("انتهت مهلة انتظار نشر الصورة؛ بقي الرابط القديم محفوظاً");
}
