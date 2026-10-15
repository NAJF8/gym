import { getApp, getApps, initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getDatabase } from 'firebase/database'
import { connectDatabaseEmulator } from 'firebase/database'
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const firebaseConfigured = Object.values(config).every(Boolean)
export const firebaseApp = firebaseConfigured ? (getApps()[0] ?? initializeApp(config)) : null
export const firebaseAuth = firebaseApp ? getAuth(firebaseApp) : null
export const firebaseDatabase = firebaseApp ? getDatabase(firebaseApp) : null
export const firebaseFunctions = firebaseApp ? getFunctions(firebaseApp) : null
export const googleProvider = new GoogleAuthProvider()

const useEmulators = import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true'
if (useEmulators && firebaseAuth && firebaseDatabase && firebaseFunctions) {
  connectAuthEmulator(firebaseAuth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectDatabaseEmulator(firebaseDatabase, '127.0.0.1', 9000)
  connectFunctionsEmulator(firebaseFunctions, '127.0.0.1', 5001)
}

