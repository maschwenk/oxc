#!/usr/bin/env node
// Assemble downloaded per-platform artifacts into the @owner/oxc-transform package directory.
//   node package-binding.mjs --artifacts <dir> --out <dir> --release [--version 0.147.0-owner.1] [--source-sha <sha>]
//   --release (CI default): every expected binary must be present with BUILD metadata, a sourceSha matching
//   --source-sha, and a matching sha256. --allow-missing builds a partial package for local experiments only.
// <artifacts> is what actions/download-artifact produces: one subdir per platform holding transform.<platform>.node,
// BUILD.<binary>.json, <binary>.sha256, index.d.ts (napi typings), LICENSE, THIRD-PARTY-LICENSE and (linux x64 only) THIRD_PARTY_LICENSES.txt.
// Output layout (what the tarball's package/ contains):
//   index.cjs index.d.cts binding.d.ts package.json transform.*.node LICENSE THIRD-PARTY-LICENSE THIRD_PARTY_LICENSES.txt BUILD.json SHA256SUMS
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = {};
for (let i = 2; i < process.argv.length; i++) {
	const a = process.argv[i];
	if (!a.startsWith("--")) continue;
	const next = process.argv[i + 1];
	args[a.slice(2)] = next === undefined || next.startsWith("--") ? true : (i++, next);
}
const { artifacts, out } = args;
const version = typeof args.version === "string" ? args.version : "0.147.0-owner.1";
if (!artifacts || !out) {
	console.error("usage: package-binding.mjs --artifacts <dir> --out <dir> [--release] [--version v] [--source-sha sha] [--allow-missing]");
	process.exit(2);
}
const EXPECTED = ["transform.linux-x64-gnu.node", "transform.linux-arm64-gnu.node", "transform.darwin-arm64.node", "transform.darwin-x64.node"];
const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const fail = (msg) => {
	console.error(msg);
	process.exit(1);
};

const found = new Map(); // filename -> absolute path (artifact subdirs or a flat dir)
const walk = (dir) => {
	for (const name of readdirSync(dir)) {
		const p = path.join(dir, name);
		if (statSync(p).isDirectory()) walk(p);
		else found.set(name, p);
	}
};
walk(artifacts);

const release = Boolean(args.release);
if (release && args["allow-missing"]) fail("--release and --allow-missing are mutually exclusive");
if (release && typeof args["source-sha"] !== "string") fail("--release requires --source-sha");
const binaries = EXPECTED.filter((b) => found.has(b));
const missing = EXPECTED.filter((b) => !found.has(b));
if (missing.length && !args["allow-missing"]) fail(`missing binaries: ${missing.join(", ")} (pass --allow-missing for a partial package)`);
if (!binaries.length) fail("no transform.*.node found");
for (const req of ["index.d.ts", "LICENSE", "THIRD-PARTY-LICENSE", ...(release ? ["THIRD_PARTY_LICENSES.txt"] : [])]) if (!found.has(req)) fail(`missing ${req} in artifacts`);

mkdirSync(out, { recursive: true });
const builds = [];
let sourceSha = typeof args["source-sha"] === "string" ? args["source-sha"] : undefined;
for (const bin of binaries) {
	const dst = path.join(out, bin);
	copyFileSync(found.get(bin), dst);
	const metaPath = found.get(`BUILD.${bin}.json`);
	if (!metaPath && release) fail(`${bin}: BUILD.${bin}.json provenance missing`);
	const meta = metaPath ? JSON.parse(readFileSync(metaPath, "utf8")) : { binary: bin };
	const actual = sha256(dst);
	if (release) {
		for (const key of ["sha256", "sourceSha", "target", "rustc"]) if (!meta[key]) fail(`${bin}: provenance lacks ${key}`);
		const sumFile = found.get(`${bin}.sha256`);
		if (!sumFile) fail(`${bin}.sha256 missing`);
		const recorded = readFileSync(sumFile, "utf8").trim().split(/\s+/)[0];
		if (recorded !== actual) fail(`${bin}: sha256 ${actual} does not match ${bin}.sha256 (${recorded})`);
	}
	if (meta.sha256 && meta.sha256 !== actual) fail(`${bin}: sha256 ${actual} does not match provenance ${meta.sha256}`);
	meta.sha256 = actual;
	if (meta.sourceSha) {
		if (sourceSha && sourceSha !== meta.sourceSha) fail(`${bin}: built from ${meta.sourceSha}, expected ${sourceSha}; refusing to mix sources`);
		sourceSha ??= meta.sourceSha;
	}
	builds.push(meta);
}
copyFileSync(found.get("index.d.ts"), path.join(out, "binding.d.ts")); // napi-generated API typings (includes exportMode)
copyFileSync(path.join(here, "loader.cjs"), path.join(out, "index.cjs"));
copyFileSync(path.join(here, "loader.d.cts"), path.join(out, "index.d.cts"));
copyFileSync(found.get("LICENSE"), path.join(out, "LICENSE"));
copyFileSync(found.get("THIRD-PARTY-LICENSE"), path.join(out, "THIRD-PARTY-LICENSE")); // upstream notice texts, verbatim
if (found.has("THIRD_PARTY_LICENSES.txt")) copyFileSync(found.get("THIRD_PARTY_LICENSES.txt"), path.join(out, "THIRD_PARTY_LICENSES.txt"));
else console.warn("warning: THIRD_PARTY_LICENSES.txt not present in artifacts");

const pkg = {
	name: "@owner/oxc-transform",
	version,
	description:
		"Private build of oxc-transform 0.147.0 (oxc_transform_napi) with moduleRunnerTransform exportMode 'ExportName' and the parenthesized-callee fix, for Olympus Vitest SSR. Distributed as a GitHub release tarball, never published to npm.",
	private: true,
	license: "MIT",
	main: "index.cjs",
	types: "index.d.cts",
	exports: { ".": { types: "./index.d.cts", default: "./index.cjs" }, "./package.json": "./package.json" },
	files: ["index.cjs", "index.d.cts", "binding.d.ts", "transform.*.node", "LICENSE", "THIRD-PARTY-LICENSE", "THIRD_PARTY_LICENSES.txt", "BUILD.json", "SHA256SUMS"],
	engines: { node: "^20.19.0 || >=22.12.0" },
	repository: { type: "git", url: "git+https://github.com/maschwenk/oxc.git", directory: "napi/transform" },
	owner: { upstream: "oxc-transform@0.147.0", oxcBaseTag: "crates_v0.147.0", sourceSha: sourceSha ?? null, platforms: binaries },
};
writeFileSync(path.join(out, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
writeFileSync(
	path.join(out, "BUILD.json"),
	JSON.stringify({ package: pkg.name, version, sourceSha: sourceSha ?? null, oxcBaseTag: "crates_v0.147.0", assembledAt: new Date().toISOString(), binaries: builds }, null, 2) + "\n",
);
const sums = readdirSync(out)
	.filter((f) => f !== "SHA256SUMS")
	.sort()
	.map((f) => `${sha256(path.join(out, f))}  ${f}`)
	.join("\n");
writeFileSync(path.join(out, "SHA256SUMS"), sums + "\n");
console.log(`packaged ${out}\n${sums}`);
if (missing.length) console.warn(`partial package, missing: ${missing.join(", ")}`);
