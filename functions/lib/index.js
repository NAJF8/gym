"use strict";
/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.addManagerByEmail = void 0;
const firebase_functions_1 = require("firebase-functions");
const https_1 = require("firebase-functions/v2/https");
const database_1 = require("firebase-admin/database");
const auth_1 = require("firebase-admin/auth");
const app_1 = require("firebase-admin/app");
// import {onRequest} from "firebase-functions/https";
// import * as logger from "firebase-functions/logger";
// Start writing functions
// https://firebase.google.com/docs/functions/typescript
// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
(0, firebase_functions_1.setGlobalOptions)({ maxInstances: 10 });
const app = (_a = (0, app_1.getApps)()[0]) !== null && _a !== void 0 ? _a : (0, app_1.initializeApp)();
const db = (0, database_1.getDatabase)(app);
const auth = (0, auth_1.getAuth)(app);
const normalizeEmail = (value) => typeof value === "string" ? value.trim().toLowerCase() : "";
async function requireSuperAdmin(uid) {
    const snapshot = await db.ref(`admins/${uid}`).once("value");
    const record = snapshot.val();
    if (!record || record.role !== "SUPER_ADMIN" || record.active !== true) {
        throw new https_1.HttpsError("permission-denied", "Only an active SUPER_ADMIN may manage managers.");
    }
}
exports.addManagerByEmail = (0, https_1.onCall)(async (request) => {
    var _a, _b, _c, _d;
    if (!((_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid) || request.auth.token.email_verified !== true || ((_b = request.auth.token.firebase) === null || _b === void 0 ? void 0 : _b.sign_in_provider) !== "google.com") {
        throw new https_1.HttpsError("unauthenticated", "A verified Google-authenticated account is required.");
    }
    await requireSuperAdmin(request.auth.uid);
    const email = normalizeEmail((_c = request.data) === null || _c === void 0 ? void 0 : _c.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new https_1.HttpsError("invalid-argument", "A valid email is required.");
    }
    let target;
    try {
        target = await auth.getUserByEmail(email);
    }
    catch (_e) {
        throw new https_1.HttpsError("not-found", "The account must sign in with Google before it can be added.");
    }
    if (((_d = target.email) === null || _d === void 0 ? void 0 : _d.toLowerCase()) !== email || target.emailVerified !== true || !target.providerData.some((provider) => provider.providerId === "google.com")) {
        throw new https_1.HttpsError("failed-precondition", "The target Google account email is not verified.");
    }
    if (target.uid === request.auth.uid) {
        throw new https_1.HttpsError("invalid-argument", "The bootstrap SUPER_ADMIN cannot be added as a manager.");
    }
    const existing = (await db.ref(`admins/${target.uid}`).once("value")).val();
    if ((existing === null || existing === void 0 ? void 0 : existing.role) === "SUPER_ADMIN") {
        throw new https_1.HttpsError("already-exists", "A second SUPER_ADMIN cannot be created or converted.");
    }
    await db.ref(`admins/${target.uid}`).set({
        role: "MANAGER",
        active: true,
        email,
        displayName: target.displayName || email,
    });
    return { uid: target.uid, email, emailVerified: target.emailVerified };
});
// export const helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });
//# sourceMappingURL=index.js.map