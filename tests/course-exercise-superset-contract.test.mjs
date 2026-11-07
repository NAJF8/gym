import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

test('course exercises can be edited directly inside the course without touching main library', () => {
  // Modal for editing exercise inside course exists
  assert.match(main, /function EditCourseExerciseModal/);
  assert.match(main, /داخل هذا الكورس فقط/);
  assert.match(main, /دون أي تغيير على مكتبة التمارين الرئيسية/);
  
  // Custom course exercise fields: name, sets, reps, notes, video, and replacement from library
  assert.match(main, /اسم التمرين داخل هذا الكورس/);
  assert.match(main, /ملاحظات التمرين داخل الكورس/);
  assert.match(main, /رابط فيديو شرح التمرين/);
  assert.match(main, /استبدال بتمرين آخر من المكتبة/);
  
  // Quick inline actions on course card: edit, delete, add exercise, direct edit exercises
  assert.match(main, /ready-inline-edit-btn/);
  assert.match(main, /ready-inline-delete-btn/);
  assert.match(main, /ready-add-exercise-btn/);
  assert.match(main, /تعديل التمارين/);
  
  // Quick exercise editing in Review (after finishing writing course)
  assert.match(main, /review-edit-btn/);
  assert.match(main, /تعديل هذا التمرين داخل الكورس/);
  assert.match(main, /onUpdateExercise/);
});

test('superset exercises are presented in ONE single rectangle on the SAME line', () => {
  // Superset card has single container rectangle
  assert.match(main, /className="ready-superset-card"/);
  assert.match(main, /className="ready-superset-row"/);
  assert.match(main, /className="review-superset-card"/);
  assert.match(main, /className="review-superset-row"/);
  assert.match(main, /تمرينين على نفس الخط داخل مستطيل واحد/);
  
  // CSS enforces 2 columns side-by-side on the same line
  assert.match(styles, /\.ready-superset-row\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/);
  assert.match(styles, /\.review-superset-row\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/);
  assert.match(styles, /\.superset-editor-items\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.member-superset-items\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  
  // 760px media query does NOT break superset into 1 column
  assert.doesNotMatch(styles, /@media\(max-width:760px\)\{\.superset-editor-items\{grid-template-columns:repeat\(auto-fit/);
});
