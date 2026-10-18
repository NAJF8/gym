import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("PIN Card contract is in-page, RTL, copyable, printable, and dismissible", () => {
  const card = main.match(/\{pin && <section className="pin-card"[\s\S]*?<\/section>\}/)?.[0] || "";
  assert.match(card, /className="pin-card"/);
  assert.doesNotMatch(card, /modal-overlay|modal\b/);
  assert.match(card, /aria-label="بطاقة رمز الدخول"/);
  assert.match(card, /navigator\.clipboard\.writeText\(pin\)/);
  assert.match(card, /window\.print\(\)/);
  assert.match(card, /setPin\('\'\)/);
  assert.match(card, /dir="ltr"/);
  assert.match(styles, /\.pin-card\{[^}]*direction:rtl/);
  assert.match(styles, /@media print\{\.pin-card\{display:block!important/);
});

test("PIN Card is transient and does not persist the raw PIN", () => {
  const card = main.match(/\{pin && <section className="pin-card"[\s\S]*?<\/section>\}/)?.[0] || "";
  assert.doesNotMatch(card, /localStorage|sessionStorage|console\.(log|info|debug|warn|error)/);
  assert.match(card, /يظهر هذا الرمز مرة واحدة فقط/);
});
