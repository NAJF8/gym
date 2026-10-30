import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QRCodeSVG } from 'qrcode.react'
import { chromium } from 'playwright'

const root = process.cwd()
const origin = 'https://alasas-fit-staging.web.app/'
const exercises = [
  ['squat', 'سكوات', 'الأرجل', 4, '10', '60 ثانية'],
  ['bench', 'ضغط صدر', 'الصدر', 3, '12', '60 ثانية'],
  ['row', 'سحب أرضي', 'الظهر', 4, '10', '75 ثانية'],
  ['lunge', 'اندفاع', 'الأرجل', 3, '12', '60 ثانية'],
  ['curl', 'بايسبس', 'الذراع', 3, '12', '45 ثانية'],
  ['plank', 'بلانك', 'البطن', 3, '45 ثانية', '45 ثانية'],
  ['stretch', 'إطالة', 'مرونة', 2, '30 ثانية', '30 ثانية'],
].map(([id, name, muscle, sets, reps, rest]) => ({ id, name, muscle, sets, reps, rest }))
const days = [exercises.slice(0, 3), exercises.slice(3, 5), exercises.slice(5)]
const target = exercise => `${origin}#/exercise/${encodeURIComponent(exercise.id)}`
const qr = exercise => renderToStaticMarkup(React.createElement(QRCodeSVG, { value: target(exercise), size: 64, includeMargin: true, level: 'M' }))
const loginQr = renderToStaticMarkup(React.createElement(QRCodeSVG, { value: origin, size: 76, includeMargin: true, level: 'M' }))
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const rows = day => day.map((e, n) => `<tr><td class="exercise-name"><strong>${n + 1}. ${escape(e.name)}</strong><small>${escape(e.muscle)}</small></td><td class="num">${e.sets}</td><td>${escape(e.reps)}</td><td>—</td><td>${escape(e.rest)}</td><td><div class="qr">${qr(e)}</div></td></tr>`).join('')
const html = `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>اختبار طباعة معزول — AL ASAS FIT</title><style>
@page{size:A4 portrait;margin:8mm}*{box-sizing:border-box}body{font-family:Arial,Tahoma,sans-serif;color:#171917;margin:0;background:#fff;direction:rtl}.header{display:grid;grid-template-columns:1fr 1.15fr 1fr;gap:12px;align-items:center;min-height:42mm}.coach{text-align:left}.coach img{width:34mm;height:34mm;border-radius:50%;object-fit:cover;border:1px solid #b7ff2a}.brand{text-align:center}.brand img{max-width:45mm;max-height:30mm;object-fit:contain}.brand strong{display:block;font-size:11px;margin-top:2px}.member{text-align:right;font-size:13px;line-height:1.8;font-weight:700}.member b{font-weight:400}.rule{height:2px;background:#b7ff2a;margin:2mm 0 5mm}.day{border:1px solid #222;border-radius:3mm;padding:0 0 2mm;margin:0 0 6mm}.day-title{width:52mm;margin:-4mm auto 2mm;background:#fff;border:1px solid #555;border-radius:2mm;text-align:center;padding:1.5mm 2mm;font-size:15px;font-weight:700}.day table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:10px}.day thead{display:table-header-group}.day tr{break-inside:avoid;page-break-inside:avoid}.day th,.day td{border:1px solid #cfd3d0;padding:1.6mm 1.5mm;vertical-align:middle;text-align:center}.day th{background:#f0f1f0;font-size:10px}.day th:nth-child(1),.day td:nth-child(1){width:38%;text-align:right}.day th:nth-child(2),.day td:nth-child(2){width:12%}.day th:nth-child(3),.day td:nth-child(3){width:15%}.day th:nth-child(4),.day td:nth-child(4){width:13%}.day th:nth-child(5),.day td:nth-child(5){width:12%}.day th:nth-child(6),.day td:nth-child(6){width:10%}.exercise-name small{display:block;color:#555;font-size:8px;margin-top:1mm}.num{font-weight:700}.qr{width:15mm;height:15mm;margin:auto;display:grid;place-items:center}.qr svg{width:13mm;height:13mm}.login-qr{display:flex;justify-content:center;margin-top:4mm;break-inside:avoid}.login-qr-box{display:flex;align-items:center;gap:4mm;border:1px solid #cfd3d0;border-radius:3mm;padding:3mm}.login-qr-box svg{width:19mm;height:19mm}.login-qr-box strong{font-size:10px;max-width:55mm;line-height:1.7}.footer{border-top:1px solid #222;margin-top:3mm;padding:3mm 0;display:flex;justify-content:space-between;gap:4mm;font-size:9px;break-inside:avoid;flex-wrap:wrap}.footer span{white-space:nowrap}.empty{padding:5mm;text-align:center;color:#666}section{break-inside:auto}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
</style></head><body><header class="header"><div class="coach"><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" alt="صورة الكابتن"></div><div class="brand"><strong>AL ASAS FIT</strong><strong>كابتن الاختبار</strong></div><div class="member"><div><b>التاريخ:</b> 2026-10-17</div><div><b>الاسم:</b> اختبار طباعة معزول</div><div><b>الوزن:</b> 78 كغم</div><div><b>الطول:</b> 178 سم</div></div></header><div class="rule"></div>${days.map((day, i) => `<section class="day"><h2 class="day-title">اليوم ${i + 1}</h2><table><thead><tr><th>التمرين</th><th>المجموعات</th><th>التكرارات</th><th>الوزن</th><th>الراحة</th><th>QR</th></tr></thead><tbody>${rows(day)}</tbody></table></section>`).join('')}<div class="login-qr"><div class="login-qr-box">${loginQr}<strong>امسح الرمز للدخول إلى حسابك وعرض جدول تمارينك</strong></div></div><footer class="footer"><span>+9647000000000</span><span>WhatsApp: +9647000000000</span><span>Instagram: @alasas.fit</span><span>بغداد — Staging Fixture</span><strong>© 2026 جميع الحقوق محفوظة لشركة الأساس للحلول البرمجية · Version 1.8</strong></footer></body></html>`
const pdfPath = join(root, 'output', 'pdf', 'staging-member-course-a4.pdf')
const previewPath = join(root, 'output', 'preview', 'staging-member-course-a4.png')
await mkdir(join(root, 'output', 'pdf'), { recursive: true })
await mkdir(join(root, 'output', 'preview'), { recursive: true })
await mkdir(join(root, 'output', 'qr'), { recursive: true })
await writeFile(join(root, 'output', 'qr-expected.json'), JSON.stringify([{ id: 'member-login', target: origin }, ...exercises.map(e => ({ id: e.id, target: target(e) }))], null, 2), 'utf8')
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 1800 }, deviceScaleFactor: 4 })
await page.setContent(html, { waitUntil: 'load' })
await page.screenshot({ path: previewPath, fullPage: true })
const qrNodes = page.locator('.qr')
for (let i = 0; i < await qrNodes.count(); i++) await qrNodes.nth(i).screenshot({ path: join(root, 'output', 'qr', `exercise-${i + 1}.png`) })
await page.locator('.login-qr').screenshot({ path: join(root, 'output', 'qr', 'member-login.png') })
await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, preferCSSPageSize: true, margin: { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' } })
console.log(JSON.stringify({ pdfPath, previewPath, expectedQr: exercises.length + 1, rtl: await page.locator('html[dir="rtl"]').count(), rows: await page.locator('tbody tr').count() }))
await browser.close()
