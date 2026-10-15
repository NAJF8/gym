import { getApps, initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getDatabase } from 'firebase/database'
import { connectDatabaseEmulator } from 'firebase/database'
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions'
import { firebaseConfig } from './firebaseConfig'

const config = firebaseConfig

export const firebaseConfigured = Boolean(
  config.apiKey &&
    config.authDomain &&
    config.databaseURL &&
    config.projectId &&
    config.messagingSenderId &&
    config.appId,
)
export const firebaseApp = firebaseConfigured ? (getApps()[0] ?? initializeApp(config)) : null
export const firebaseAuth = firebaseApp ? getAuth(firebaseApp) : null
export const firebaseDatabase = firebaseApp ? getDatabase(firebaseApp) : null
export const firebaseFunctions = firebaseApp ? getFunctions(firebaseApp) : null
export const googleProvider = new GoogleAuthProvider()

const useEmulators = import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true'
const emulatorHost = import.meta.env.VITE_FIREBASE_EMULATOR_HOST || '127.0.0.1'
const authPort = Number(import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_PORT || 9099)
const databasePort = Number(import.meta.env.VITE_FIREBASE_DATABASE_EMULATOR_PORT || 9000)
const functionsPort = Number(import.meta.env.VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT || 5001)

/** Safe runtime identifiers for support diagnostics; credentials and tokens are deliberately excluded. */
export const firebaseRuntimeMetadata = {
  projectId: config.projectId || null,
  databaseURL: config.databaseURL || null,
  useEmulators,
  authEmulator: useEmulators ? `${emulatorHost}:${authPort}` : null,
  databaseEmulator: useEmulators ? `${emulatorHost}:${databasePort}` : null,
  functionsEmulator: useEmulators ? `${emulatorHost}:${functionsPort}` : null,
}

if (useEmulators && firebaseAuth && firebaseDatabase && firebaseFunctions) {
  connectAuthEmulator(firebaseAuth, `http://${emulatorHost}:${authPort}`, { disableWarnings: true })
  connectDatabaseEmulator(firebaseDatabase, emulatorHost, databasePort)
  connectFunctionsEmulator(firebaseFunctions, emulatorHost, functionsPort)
}

