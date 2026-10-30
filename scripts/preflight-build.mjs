import process from 'node:process'

const mode = process.argv[2] || process.env.VITE_RELEASE_ENVIRONMENT || process.env.NODE_ENV || ''
const expected = mode === 'staging'
  ? { project: 'alasas-fit-staging', worker: 'alasas-fit-member-auth-staging.coffee101.workers.dev', database: 'alasas-fit-staging-default-rtdb.firebaseio.com' }
  : mode === 'production'
    ? { project: 'gym1-4f1bb', worker: 'alasas-fit-member-auth.coffee101.workers.dev', database: 'gym1-4f1bb-default-rtdb.firebaseio.com' }
    : null

if (!expected) {
  if (process.env.VITE_RELEASE_ENVIRONMENT) throw new Error('VITE_RELEASE_ENVIRONMENT must be staging or production')
  console.log('Firebase/Worker preflight skipped for a non-release build')
  process.exit(0)
}

const required = [
  'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_DATABASE_URL',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_MESSAGING_SENDER_ID', 'VITE_FIREBASE_APP_ID', 'VITE_PIN_SERVICE_ENDPOINT',
]
const missing = required.filter(name => !String(process.env[name] || '').trim())
if (missing.length) throw new Error(`Release preflight failed: missing ${missing.join(', ')}`)

const database = new URL(process.env.VITE_FIREBASE_DATABASE_URL)
const worker = new URL(process.env.VITE_PIN_SERVICE_ENDPOINT)
const errors = []
if (process.env.VITE_FIREBASE_PROJECT_ID !== expected.project) errors.push(`Firebase project must be ${expected.project}`)
const expectedAuthDomain = `${expected.project}.firebaseapp.com`
if (process.env.VITE_FIREBASE_AUTH_DOMAIN !== expectedAuthDomain) errors.push(`Firebase auth domain must be ${expectedAuthDomain}`)
if (database.hostname !== expected.database) errors.push(`RTDB host must be ${expected.database}`)
if (worker.protocol !== 'https:' || worker.hostname !== expected.worker) errors.push(`PIN Worker must be https://${expected.worker}`)
if (process.env.VITE_RELEASE_ENVIRONMENT === 'staging' && worker.hostname === 'alasas-fit-member-auth.coffee101.workers.dev') errors.push('Staging cannot use the Production PIN Worker')
if (process.env.VITE_RELEASE_ENVIRONMENT === 'production' && worker.hostname === 'alasas-fit-member-auth-staging.coffee101.workers.dev') errors.push('Production cannot use the Staging PIN Worker')
if (errors.length) throw new Error(`Release preflight failed: ${errors.join('; ')}`)

const firebaseApiKey = process.env.VITE_FIREBASE_API_KEY
const apiKeyCheck = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(firebaseApiKey)}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ returnSecureToken: true }),
})
const apiKeyCheckBody = await apiKeyCheck.json().catch(() => ({}))
if (apiKeyCheckBody?.error?.details?.some(detail => detail?.reason === 'API_KEY_INVALID')) {
  throw new Error('Release preflight failed: Firebase API key was rejected by Identity Toolkit')
}
if (!apiKeyCheckBody?.error?.message && !apiKeyCheck.ok) {
  throw new Error(`Release preflight failed: Firebase API key validation returned HTTP ${apiKeyCheck.status}`)
}

console.log(JSON.stringify({ environment: mode, project: expected.project, databaseHost: database.hostname, workerHost: worker.hostname, ok: true }))
