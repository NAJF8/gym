import process from 'node:process'

const args = Object.fromEntries(process.argv.slice(2).map((value) => {
  const [key, ...rest] = value.replace(/^--/, '').split('=')
  return [key, rest.join('=') || 'true']
}))

const expected = {
  staging: {
    project: 'alasas-fit-staging',
    database: 'alasas-fit-staging-default-rtdb.firebaseio.com',
    worker: 'alasas-fit-member-auth-staging.coffee101.workers.dev',
    url: 'https://alasas-fit-staging.web.app/admin/',
  },
  production: {
    project: 'gym1-4f1bb',
    database: 'gym1-4f1bb-default-rtdb.firebaseio.com',
    worker: 'alasas-fit-member-auth.coffee101.workers.dev',
    url: 'https://fit.alasas.tech/admin/',
  },
}[args.environment]

if (!expected) throw new Error('LIVE_DEPLOYMENT_GUARD_FAILED: environment must be staging or production')

const pageUrl = args.url || expected.url
const page = await fetch(pageUrl, { cache: 'no-store' })
if (!page.ok) throw new Error(`LIVE_DEPLOYMENT_GUARD_FAILED: ${pageUrl} returned HTTP ${page.status}`)
const html = await page.text()
const scriptPath = html.match(/<script[^>]+src=["']([^"']+\.js)["']/i)?.[1]
if (!scriptPath) throw new Error('LIVE_DEPLOYMENT_GUARD_FAILED: release HTML has no JavaScript entrypoint')

const scriptUrl = new URL(scriptPath, pageUrl).toString()
const script = await fetch(scriptUrl, { cache: 'no-store' })
if (!script.ok) throw new Error(`LIVE_DEPLOYMENT_GUARD_FAILED: ${scriptUrl} returned HTTP ${script.status}`)
const bundle = await script.text()

const checks = {
  project: bundle.includes(`projectId:\`${expected.project}\``) || bundle.includes(`projectId:"${expected.project}"`) || bundle.includes(`projectId:'${expected.project}'`),
  database: bundle.includes(expected.database),
  worker: bundle.includes(expected.worker),
  teamAccess: bundle.includes('/v1/admin/management/list') && bundle.includes('Team & Access'),
}
const failed = Object.entries(checks).filter(([, value]) => !value).map(([key]) => key)
if (failed.length) throw new Error(`LIVE_DEPLOYMENT_GUARD_FAILED: ${args.environment} bundle mismatch: ${failed.join(', ')}`)

console.log(JSON.stringify({
  environment: args.environment,
  pageUrl,
  scriptUrl,
  pageStatus: page.status,
  scriptStatus: script.status,
  checks,
  ok: true,
}))
