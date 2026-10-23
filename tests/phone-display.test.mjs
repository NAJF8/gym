import test from "node:test";
import assert from "node:assert/strict";
import { displayIraqiPhone, normalizeIraqiPhone } from "../src/phone.ts";

test("accepts supported Iraqi input forms and separates display from E.164", () => {
  for (const input of ["07821234567", "7821234567", "+9647821234567", "009647821234567"]) {
    assert.equal(normalizeIraqiPhone(input), "+9647821234567");
    assert.equal(displayIraqiPhone(input), "07821234567");
  }
});

test("accepts Arabic-Indic digits for member input", () => {
  assert.equal(displayIraqiPhone("٠٧٨٢١٢٣٤٥٦٧"), "07821234567");
});

test("rejects missing or malformed member phones", () => {
  assert.throws(() => normalizeIraqiPhone(""), /رقم هاتف غير صالح/);
  assert.throws(() => normalizeIraqiPhone("0782123456"), /رقم هاتف غير صالح/);
});
