/**
 * Public Firebase Web App configuration for gym1-4f1bb.
 *
 * These values identify the browser client only. They are not Admin SDK
 * credentials, tokens, or private keys. Keep emulator selection separate so a
 * production build can never inherit emulator endpoints from a developer
 * machine.
 */
export const firebaseConfig = {
  apiKey: 'AIzaSyCxsUDPM7LpZn6Ct6F6GM-RCNm_sUhzcGk',
  authDomain: 'gym1-4f1bb.firebaseapp.com',
  databaseURL: 'https://gym1-4f1bb-default-rtdb.firebaseio.com',
  projectId: 'gym1-4f1bb',
  storageBucket: 'gym1-4f1bb.firebasestorage.app',
  messagingSenderId: '899053567080',
  appId: '1:899053567080:web:7c09b1848ede42aa2b0fdd',
} as const

export const firebaseConfigValidation = {
  expectedProjectId: 'gym1-4f1bb',
  expectedAuthDomain: 'gym1-4f1bb.firebaseapp.com',
  expectedDatabaseURL: 'https://gym1-4f1bb-default-rtdb.firebaseio.com',
}
