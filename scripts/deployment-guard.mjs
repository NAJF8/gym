import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((value) => { const [key, ...rest] = value.replace(/^--/, "").split("="); return [key, rest.join("=") || "true"]; }));
const expected = { staging: { project: "alasas-fit-staging", site: "alasas-fit-staging" }, production: { project: "gym1-4f1bb", site: "gym1-4f1bb" } }[args.environment];
const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, args.dist || "dist");
if (!expected || args.project !== expected.project || args.site !== expected.site) throw new Error(`DEPLOYMENT_GUARD_FAILED: FIT ${args.environment || "unknown"} must target ${expected?.project || "known environment"}/${expected?.site || "known site"}`);
const firebaserc = JSON.parse(readFileSync(resolve(root, ".firebaserc"), "utf8"));
const firebase = JSON.parse(readFileSync(resolve(root, "firebase.json"), "utf8"));
if (args.environment === "production" && firebaserc.projects?.default !== args.project) throw new Error(`DEPLOYMENT_GUARD_FAILED: .firebaserc default is not ${args.project}`);
if (firebase.hosting?.public !== "dist") throw new Error("DEPLOYMENT_GUARD_FAILED: FIT hosting must publish dist");
for (const entry of ["index.html", "admin/index.html", "release.json"]) if (!existsSync(resolve(dist, entry))) throw new Error(`DEPLOYMENT_GUARD_FAILED: FIT dist/${entry} is missing`);
const files = [];
function walk(dir) { for (const entry of readdirSync(dir)) { const path = resolve(dir, entry); if (statSync(path).isDirectory()) walk(path); else files.push(path); } }
walk(dist);
if (!files.some((file) => readFileSync(file, "utf8").includes(args.project))) throw new Error(`DEPLOYMENT_GUARD_FAILED: FIT bundle is not built for ${args.project}`);
const forbidden = /al-asas-platform(?:-staging)?(?:\.firebaseapp|\.web\.app)|alasas\.tech|al-asas-media-staging/i;
for (const file of files) if (statSync(file).size <= 2_000_000 && forbidden.test(readFileSync(file, "utf8"))) throw new Error(`DEPLOYMENT_GUARD_FAILED: Platform runtime identifier found in ${file}`);
console.log(`DEPLOYMENT_GUARD_PASS FIT ${args.environment}: project=${args.project} site=${args.site} dist=${dist}`);
