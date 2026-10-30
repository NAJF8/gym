import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

test("shared modal is portaled above the app shell and exposes an accessible dialog", () => {
  assert.match(source, /createPortal\(content, document\.body\)/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /aria-labelledby=\{titleId\}/);
  assert.match(source, /aria-label="إغلاق النافذة"/);
});

test("shared modal owns keyboard focus and prevents background scrolling", () => {
  assert.match(source, /document\.body\.style\.overflow = "hidden"/);
  assert.match(source, /document\.addEventListener\("keydown", onKeyDown, true\)/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /event\.key !== "Tab"/);
  assert.match(source, /previousFocusRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(styles, /\.modal-overlay\{z-index:11000/);
  assert.match(styles, /\.modal\[role="dialog"\] \.modal-scroll-content\{[^}]*overflow-y:auto/);
});
