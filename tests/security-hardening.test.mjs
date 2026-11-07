import { readFile } from 'node:fs/promises'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTestEnv } from './helpers/worker-env.mjs'
import { derivePin, hashPin, PIN_HASH_ALGORITHM, constantTimeEqual, base64ToBytes } from '../worker/src/crypto.ts'
import { escapeHtml, printImageSrc, printImageTag } from '../src/imageUrl.ts'
import { canEditSiteSettings, canViewSiteSettings, isAdminPath } from '../src/access.ts'

const root = new URL('../', import.meta.url)
const read = file => readFile(new URL(file, root), 'utf8')
const PEPPER = 'staging-test-secret-pepper-2026'
const member = (id, phone) => ({ id, membershipId: `M-${id}`, name: `Member ${id}`, phoneE164: phone, phoneDisplay: phone, active: true, days: [] })
const members = {
  'm-1': member('m-1', '+9647701234567'),
  'm-2': member('m-2', '+9647809876543'),
}
const login = (ctx, phone, pin, ip) => ctx.callWorker('/v1/member/login', { phone, pin }, '', { 'cf-connecting-ip': ip })
const bytes = value => base64ToBytes(value)

/* ------------------------------------------------------------------ 1. XSS */

const payloads = [
  '"><script>alert(1)</script>',
  '" onerror="alert(1)',
  'javascript:alert(1)',
  '<img src=x onerror=alert(1)>',
  'vbscript:msgbox(1)',
  'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  '//evil.example/x.png',
  '/../../etc/passwd',
  'https://example.com/a.png" onerror="alert(1)',
  "https://example.com/a.png' onerror='alert(1)",
]

test('XSS: every attack payload is rejected as an image source', () => {
  for (const payload of payloads) {
    assert.equal(printImageSrc(payload), null, payload)
    assert.equal(printImageTag(payload, 'x'), '', payload)
  }
})

test('XSS: valid image sources survive and are attribute-safe', () => {
  assert.equal(printImageTag('https://example.com/coach.png', 'Coach'), '<img src="https://example.com/coach.png" alt="Coach">')
  assert.equal(printImageTag('/gym/assets/coach.webp', 'Coach'), '<img src="/gym/assets/coach.webp" alt="Coach">')
  assert.match(printImageTag('data:image/png;base64,AAAA', 'c'), /^<img src="data:image\/png;base64,AAAA" alt="c">$/)
  assert.equal(printImageTag(undefined, 'x'), '')
  assert.equal(printImageTag(null, 'x'), '')
})

test('XSS: alt text and text nodes cannot break out of their context', () => {
  for (const payload of payloads) {
    const tag = printImageTag('https://example.com/a.png', `شعار ${payload}`)
    assert.match(tag, /^<img src="[^"<>]*" alt="[^"<>]*">$/, payload)
    assert.doesNotMatch(tag, /<script/i)
    const text = escapeHtml(payload)
    assert.doesNotMatch(text, /[<>"']/, payload)
  }
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;')
  assert.equal(escapeHtml(null), '')
})

test('XSS: print HTML builder routes every dynamic image and value through the safe helpers', async () => {
  const source = await read('src/main.tsx')
  const start = source.indexOf('function buildPrintMemberHtml')
  const end = source.indexOf('function PrintPreviewModal')
  const builder = source.slice(start, end)
  assert.ok(start > 0 && end > start)
  assert.doesNotMatch(builder, /<img src="\$\{(?:coachPhoto|s\.logo)\}"/)
  assert.match(builder, /printImageTag\(coachPhoto,/)
  assert.match(builder, /printImageTag\(s\.logo,/)
  // Every ${...} interpolation inside the template must be escaped, a number, a safe helper, or a constant.
  const allowed = /^(?:escapeHtml\(|printImageTag\(|renderToStaticMarkup\(|rows\(|qrMarkup\(|label\b|cards\b|items\b|qr\b|note\b|memberNotes\b|footerNote\b|socialFooter\b|courseQrMarkup\b|columns\b|number\b|i \+ 1|block\.items\.length|s\.showBarcodes|s\.showDate|s\.showWeight|s\.showHeight|m\.courseName \?|m\.expiresAt \?|m\.days\.map|m\.dayNotes|memberNotes \?|dayMuscles|dayTitle|day\.length|s\.address \?|footerNote \?|PRINT_DOCUMENT_CSP|coachPhoto|\(?s\.|block\.kind|target|e\.notes|string|\/\/|"|'|`)/
  const raw = [...builder.matchAll(/\$\{([^}]{0,40})/g)].map(m => m[1].trim())
  for (const expr of raw) assert.match(expr, allowed, `unreviewed interpolation: ${expr}`)
  assert.doesNotMatch(builder, /\$\{(?:m\.name|m\.notes|s\.gymName|s\.coachName|s\.phone|s\.address|s\.instagram)\}/)
  assert.doesNotMatch(builder, /<script/i)
  assert.match(source, /PRINT_DOCUMENT_CSP = "[^"]*script-src 'none'/)
})

test('XSS: preview iframe is sandboxed with no permissions and print window is detached', async () => {
  const source = await read('src/main.tsx')
  const frame = source.slice(source.indexOf('className="print-preview-frame"'), source.indexOf('className="print-preview-frame"') + 700)
  assert.match(frame, /sandbox=""/)
  assert.doesNotMatch(frame, /allow-same-origin|allow-scripts|allow-modals|allow-popups/)
  const print = source.slice(source.indexOf('function printMember'), source.indexOf('function printMember') + 1800)
  assert.match(print, /w\.opener = null/)
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|\beval\(|new Function\(/)
})

/* ------------------------------------------------------ 2. Security headers */

test('hosting config adds security headers on every path without breaking cache rules', async () => {
  for (const file of ['firebase.json', 'firebase.staging.json']) {
    const hosting = JSON.parse(await read(file)).hosting
    const all = hosting.headers.find(entry => entry.source === '**')
    assert.ok(all, `${file} must define a ** header block`)
    const headers = Object.fromEntries(all.headers.map(h => [h.key, h.value]))
    assert.equal(headers['X-Frame-Options'], 'DENY')
    assert.equal(headers['X-Content-Type-Options'], 'nosniff')
    assert.equal(headers['Referrer-Policy'], 'strict-origin-when-cross-origin')
    assert.equal(headers['Permissions-Policy'], 'camera=(), microphone=(), geolocation=()')
    assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/)
    // The policy must not restrict scripts/connect/frames, which Firebase Auth, Worker API and YouTube need.
    assert.doesNotMatch(headers['Content-Security-Policy'], /script-src|default-src|connect-src|frame-src|img-src/)
    assert.ok(hosting.headers.some(entry => entry.source === '/assets/**'))
    assert.ok(hosting.headers.some(entry => entry.source === '/index.html'))
  }
})

/* ------------------------------------------------------ 3. DoS rate bucket */

test('DoS: unknown phones use a per-source bucket, never a global one', async () => {
  const source = await read('worker/src/index.ts')
  assert.doesNotMatch(source, /unknown:global/)
  const ctx = createTestEnv(members)
  const res = await login(ctx, '07901112233', '1234', '203.0.113.9')
  assert.equal(res.status, 401)
  assert.ok(ctx.buckets.has('unknown:203.0.113.9'))
  assert.ok(ctx.buckets.has('source:203.0.113.9'))
  assert.ok([...ctx.buckets.keys()].every(key => !key.includes('global')))
})

test('DoS: one attacker exhausting their bucket cannot lock out real members elsewhere', async () => {
  const ctx = createTestEnv(members)
  await ctx.callWorker('/v1/admin/member-pin', { memberId: 'm-1', phone: '07701234567', customPin: '4826' }, 'valid-captain-token')
  let last
  for (let i = 0; i < 25; i += 1) {
    last = await login(ctx, `0790${String(1000000 + i)}`, '1234', '203.0.113.50')
  }
  assert.equal(last.status, 429, 'attacker is rate limited')
  const attackerRetry = await login(ctx, '07701234567', '4826', '203.0.113.50')
  assert.equal(attackerRetry.status, 429, 'locked source stays locked')
  const real = await login(ctx, '07701234567', '4826', '198.51.100.77')
  assert.equal(real.status, 200, 'real member from another source is unaffected')
  const other = await login(ctx, '07901112233', '1234', '198.51.100.78')
  assert.equal(other.status, 401, 'other sources are not locked either')
})

test('DoS: known-member lockout and 429 still work (5 failures per account)', async () => {
  const ctx = createTestEnv(members)
  await ctx.callWorker('/v1/admin/member-pin', { memberId: 'm-1', phone: '07701234567', customPin: '4826' }, 'valid-captain-token')
  for (let i = 0; i < 4; i += 1) assert.equal((await login(ctx, '07701234567', '0000', '198.51.100.1')).status, 401)
  assert.equal((await login(ctx, '07701234567', '0000', '198.51.100.1')).status, 401)
  const locked = await login(ctx, '07701234567', '4826', '198.51.100.1')
  assert.equal(locked.status, 429)
  assert.deepEqual(await locked.json(), { error: 'بيانات الدخول غير صحيحة' })
  ctx.advanceTime(16 * 60_000)
  assert.equal((await login(ctx, '07701234567', '4826', '198.51.100.1')).status, 200)
})

test('DoS: spoofed X-Forwarded-For is not trusted outside the local emulator', async () => {
  const ctx = createTestEnv(members)
  delete ctx.env.LOCAL_EMULATOR_ONLY
  delete ctx.env.PIN_PEPPER
  ctx.env.PIN_ENCRYPTION_KEY = 'prod-like-secret-key'
  // Without cf-connecting-ip every request collapses to the same "unknown" source regardless of XFF,
  // so rotating a forged header cannot mint fresh buckets.
  const forged = []
  for (let i = 0; i < 25; i += 1) {
    forged.push(await ctx.callWorker('/v1/member/login', { phone: `0790${3000000 + i}`, pin: '1234' }, '', { 'cf-connecting-ip': '', 'x-forwarded-for': `10.0.0.${i}` }))
  }
  assert.ok([...ctx.buckets.keys()].every(key => !key.includes('10.0.0.')))
  assert.equal(forged.at(-1).status, 429)
})

/* ---------------------------------------------------------- 4. PIN pepper */

test('pepper: new PINs are stored peppered and the pepper is never exposed', async () => {
  const ctx = createTestEnv(members)
  const logs = []
  const original = console.log
  console.log = (...args) => logs.push(args.join(' '))
  let issued, bodyText
  try {
    const res = await ctx.callWorker('/v1/admin/member-pin', { memberId: 'm-1', phone: '07701234567', customPin: '4826' }, 'valid-captain-token')
    bodyText = await res.clone().text()
    issued = await res.json()
    const bad = await login(ctx, '07701234567', '0000', '198.51.100.2')
    bodyText += await bad.text()
    const good = await login(ctx, '07701234567', '4826', '198.51.100.3')
    bodyText += await good.text()
    assert.equal(good.status, 200)
  } finally { console.log = original }
  assert.equal(issued.pin, '4826')
  const row = ctx.credentials.get('m-1')
  assert.equal(row.hash_algorithm, PIN_HASH_ALGORITHM)
  const salt = bytes(row.pin_salt)
  assert.equal(constantTimeEqual(await derivePin('4826', salt, PEPPER), bytes(row.pin_hash)), true)
  assert.equal(constantTimeEqual(await derivePin('4826', salt), bytes(row.pin_hash)), false, 'unpeppered derivation must not match the new credential')
  assert.equal(constantTimeEqual(await derivePin('0000', salt, PEPPER), bytes(row.pin_hash)), false)
  assert.equal(bodyText.includes(PEPPER), false)
  assert.equal(logs.join('\n').includes(PEPPER), false)
})

test('pepper: reveal/reset paths also write peppered credentials', async () => {
  const ctx = createTestEnv(members)
  const reveal = await (await ctx.callWorker('/v1/admin/member-pin-reveal', { memberId: 'm-2' }, 'valid-captain-token')).json()
  assert.equal(ctx.credentials.get('m-2').hash_algorithm, PIN_HASH_ALGORITHM)
  assert.equal((await login(ctx, '07809876543', reveal.pin, '198.51.100.4')).status, 200)
  await ctx.callWorker('/v1/admin/member-pin', { memberId: 'm-2', phone: '07809876543', reset: true, customPin: '7391' }, 'valid-captain-token')
  assert.equal(ctx.credentials.get('m-2').hash_algorithm, PIN_HASH_ALGORITHM)
  assert.equal((await login(ctx, '07809876543', '7391', '198.51.100.4')).status, 200)
  assert.equal((await login(ctx, '07809876543', reveal.pin === '7391' ? '0000' : reveal.pin, '198.51.100.4')).status, 401)
})

test('pepper: legacy unpeppered credentials still log in and are upgraded in place', async () => {
  const ctx = createTestEnv(members)
  await ctx.callWorker('/v1/admin/member-pin', { memberId: 'm-1', phone: '07701234567', customPin: '4826' }, 'valid-captain-token')
  const legacy = await hashPin('4826')
  const row = ctx.credentials.get('m-1')
  Object.assign(row, { pin_hash: legacy.hash, pin_salt: legacy.salt, hash_algorithm: 'PBKDF2-SHA256' })
  const version = row.credential_version

  const wrong = await login(ctx, '07701234567', '1111', '198.51.100.5')
  assert.equal(wrong.status, 401)
  assert.equal(row.pin_hash, legacy.hash, 'a failed login must not touch the credential')
  assert.equal(row.hash_algorithm, 'PBKDF2-SHA256')

  const ok = await login(ctx, '07701234567', '4826', '198.51.100.5')
  assert.equal(ok.status, 200, 'legacy PIN keeps working')
  assert.equal(row.hash_algorithm, PIN_HASH_ALGORITHM)
  assert.notEqual(row.pin_hash, legacy.hash)
  assert.equal(row.credential_version, version, 'migration is invisible: same credential version')
  assert.equal(constantTimeEqual(await derivePin('4826', bytes(row.pin_salt), PEPPER), bytes(row.pin_hash)), true)

  assert.equal((await login(ctx, '07701234567', '4826', '198.51.100.6')).status, 200, 'upgraded credential verifies')
  assert.equal((await login(ctx, '07701234567', '1111', '198.51.100.6')).status, 401)
})

test('pepper: every hashPin/derivePin call site in the worker passes the server pepper', async () => {
  const source = await read('worker/src/index.ts')
  for (const call of source.match(/\b(?:hashPin|derivePin)\([^;]*;/g) || []) {
    if (call.includes('import')) continue
    assert.match(call, /pinCipherSecret\(env\)|storedHashPepper\(env,/, call)
  }
  assert.doesNotMatch(source, /hash_algorithm = 'PBKDF2-SHA256'/)
  assert.doesNotMatch(source, /console\.(?:log|error|warn)\([^)]*(?:PIN_PEPPER|PIN_ENCRYPTION_KEY|pinCipherSecret)/)
})

/* -------------------------------------------------------------- 5. adminRoute */

test('adminRoute: only the admin entry point matches', () => {
  for (const path of ['/admin', '/admin/', '/admin/index.html', '/admin/index.html/', '/ADMIN', '/Admin/Index.HTML', '//admin//']) {
    assert.equal(isAdminPath(path), true, path)
  }
  for (const path of ['/', '', '/member', '/member/admin-test', '/foo/admin-test', '/foo/admin', '/admin-test', '/administrator', '/admin/other', '/admin/index.html/extra']) {
    assert.equal(isAdminPath(path), false, path)
  }
})

test('adminRoute: RootRouter uses the helper, not an ad-hoc suffix check', async () => {
  const source = await read('src/main.tsx')
  assert.match(source, /isAdminPath\(window\.location\.pathname\)/)
  assert.doesNotMatch(source, /endsWith\("\/admin"\)/)
})

/* ---------------------------------------------------- 6. COACH settings access */

test('COACH settings: SUPER_ADMIN and MANAGER can see/edit, COACH cannot', () => {
  assert.equal(canViewSiteSettings('SUPER_ADMIN'), true)
  assert.equal(canViewSiteSettings('MANAGER'), true)
  assert.equal(canViewSiteSettings('COACH'), false)
  assert.equal(canEditSiteSettings('SUPER_ADMIN'), true)
  assert.equal(canEditSiteSettings('MANAGER'), true)
  assert.equal(canEditSiteSettings('COACH'), false)
  assert.equal(canEditSiteSettings(undefined), false)
  assert.equal(canEditSiteSettings('ROOT'), false)
})

test('COACH settings: sidebar link and page are gated, RTDB rules stay the real protection', async () => {
  const source = await read('src/main.tsx')
  assert.match(source, /\{canEditSiteSettings\(role\) && \(\s*<button\s+className=\{`nav-item \$\{page === "settings"/)
  assert.match(source, /page === "settings" && canEditSiteSettings\(role\)/)
  assert.match(source, /page === "settings" && !canEditSiteSettings\(role\)\) setPage\("home"\)/)
  const rules = JSON.parse(await read('database.rules.json')).rules
  const writes = []
  const walk = node => { if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) { if (k === '.write' && typeof v === 'string') writes.push(v); else walk(v) } }
  walk(rules.appData.settings)
  assert.ok(writes.length > 0)
  for (const write of writes) {
    assert.match(write, /'SUPER_ADMIN'/)
    assert.doesNotMatch(write, /COACH/)
  }
  assert.match(rules.appData.settings.logo['.write'], /'MANAGER'/)
  assert.match(rules.appData.settings.printCoachPhotoUrl['.write'], /'MANAGER'/)
})

/* -------------------------------------------------------- 7. customToken */

test('customToken: dead flow is gone from frontend and the worker never issues it', async () => {
  for (const file of ['src/main.tsx', 'src/memberPin.ts', 'worker/src/index.ts']) {
    const source = await read(file)
    assert.doesNotMatch(source, /customToken|signInWithCustomToken/, file)
  }
  assert.doesNotMatch(await read('src/main.tsx'), /await import\(\s*['"]firebase\/auth['"]/)
  assert.match(await read('src/main.tsx'), /result\.member&&result\.sessionToken/)
})
