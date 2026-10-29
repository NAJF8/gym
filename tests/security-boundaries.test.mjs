import { readFile } from 'node:fs/promises'
import test from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('../', import.meta.url)
const read = file => readFile(new URL(file, root), 'utf8')

test('release tooling uses pinned Firebase and Wrangler versions', async () => {
  const files = [
    '.github/workflows/firebase-production.yml',
    '.github/workflows/firebase-staging.yml',
    '.github/workflows/release-ci.yml',
    '.github/workflows/staging-pr.yml',
    'scripts/backup-staging.ps1',
    'README.md',
    'package.json',
  ]
  for (const file of files) assert.doesNotMatch(await read(file), /(?:firebase-tools|wrangler)@latest/)
})

test('staging and production worker origins stay disjoint', async () => {
  const staging = await read('worker/wrangler.toml')
  const production = await read('worker/wrangler.production.toml')
  assert.doesNotMatch(staging, /https:\/\/fit\.alasas\.tech/)
  assert.match(production, /https:\/\/fit\.alasas\.tech/)
})

test('legacy callable deployment is retired from Firebase configuration', async () => {
  const firebase = JSON.parse(await read('firebase.json'))
  assert.equal(Object.hasOwn(firebase, 'functions'), false)
  assert.doesNotMatch(await read('worker/src/index.ts'), /addManagerByEmail/)
})

test('configured Firebase environments do not persist member snapshots in localStorage', async () => {
  const source = await read('src/main.tsx')
  const sync = await read('src/dataSync.ts')
  assert.match(sync, /sessionStorage\.setItem\(key, JSON\.stringify\(payload\)\)/)
  assert.match(source, /members: \[\]/)
  assert.match(source, /if \(!firebaseConfigured\)/)
  assert.doesNotMatch(source, /localStorage\.setItem\("alasas-local-migration-backup"/)
})
