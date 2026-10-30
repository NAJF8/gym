import { execFileSync, spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const required = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_DATABASE_URL',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_PIN_SERVICE_ENDPOINT',
]

function repositoryName() {
  const configured = process.env.GITHUB_REPOSITORY?.trim()
  if (configured) return configured
  const remote = execFileSync('git', ['config', '--get', 'remote.origin.url'], { encoding: 'utf8' }).trim()
  const match = remote.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/i)
  if (!match) throw new Error('Staging build could not determine the GitHub repository for the staging environment.')
  return match[1]
}

function readStagingVariable(name, repository) {
  try {
    return execFileSync('gh', ['variable', 'get', name, '--env', 'staging', '--repo', repository, '--json', 'value', '--jq', '.value'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

const env = { ...process.env, VITE_RELEASE_ENVIRONMENT: 'staging', VITE_BASE_PATH: process.env.VITE_BASE_PATH || '/' }
let source = 'process environment'
const repository = repositoryName()

for (const name of required) {
  if (!String(env[name] || '').trim()) {
    const value = readStagingVariable(name, repository)
    if (value) {
      env[name] = value
      source = `GitHub Environment staging (${repository})`
    }
  }
}

const missing = required.filter(name => !String(env[name] || '').trim())
if (missing.length) {
  throw new Error(`Staging build requires the existing GitHub Environment staging variables or explicit process variables: ${missing.join(', ')}`)
}

console.log(JSON.stringify({ environment: 'staging', configSource: source, project: env.VITE_FIREBASE_PROJECT_ID, workerHost: new URL(env.VITE_PIN_SERVICE_ENDPOINT).hostname }))

function run(command, args) {
  const result = spawnSync(command, args, { cwd: resolve('.'), env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run(process.execPath, ['scripts/preflight-build.mjs', 'staging'])
run(process.execPath, ['node_modules/typescript/bin/tsc', '-b'])
run(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', 'staging'])
