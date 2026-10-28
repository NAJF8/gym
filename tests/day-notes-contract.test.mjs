import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
const dataSync = fs.readFileSync(new URL("../src/dataSync.ts", import.meta.url), "utf8");

test("day notes remain independently editable and are included in member/course output", () => {
  assert.match(main, /setDayNote=\{\(value\) => setDayNotes\(\(x\) => x\.map\(\(note, i\) => i === day \? value : note\)\)\}/);
  assert.match(main, /dayNotes: cloneDayNotes\(dayNotes, days\)/);
  assert.match(main, /className="member-day-note"/);
  assert.match(main, /class="day-note"/);
  assert.match(main, /\.day-note\{[^}]*border:1px solid/);
  assert.match(main, /\.day-note span\{[^}]*white-space:pre-wrap/);
});

test("RTDB projections carry bounded per-day notes to read-only consumers", () => {
  assert.match(dataSync, /dayNotes: normalizeDayNotes\(course\.dayNotes, Array\.isArray\(course\.days\) \? course\.days\.length : 0\)/);
  assert.match(dataSync, /dayNotes: normalizeDayNotes\(m\.dayNotes, Array\.isArray\(m\.days\) \? m\.days\.length : 0\)/);
  assert.match(dataSync, /dayNotes: normalizeDayNotes\(member\.dayNotes, Array\.isArray\(member\.days\) \? member\.days\.length : 0\)/);
  assert.match(dataSync, /slice\(0, 2000\)/);
});
