"use strict";
// @owner/oxc-transform loader. Resolves the platform binary that ships inside this package; no network,
// no postinstall, no fallback to @oxc-transform/binding-* packages, no os/cpu gate in package.json so the
// package installs everywhere as a plain devDependency. Unsupported platforms resolve to null so the caller
// (Olympus vite config, experimental.moduleRunnerTransformBinding) keeps the stock Vite ssrTransform path.
const path = require("node:path");
const fs = require("node:fs");

const SUPPORTED = {
	"linux-x64": "transform.linux-x64-gnu.node",
	"linux-arm64": "transform.linux-arm64-gnu.node",
	"darwin-arm64": "transform.darwin-arm64.node",
	"darwin-x64": "transform.darwin-x64.node",
};

function isMusl() {
	if (process.platform !== "linux") return false;
	try {
		if (fs.readFileSync("/usr/bin/ldd", "utf8").includes("musl")) return true;
	} catch {}
	const report = typeof process.report?.getReport === "function" ? process.report.getReport() : null;
	if (report?.header?.glibcVersionRuntime) return false;
	return Array.isArray(report?.sharedObjects) && report.sharedObjects.some((f) => f.includes("libc.musl-") || f.includes("ld-musl-"));
}

function platformKey() {
	return `${process.platform}-${process.arch}`;
}

/**
 * Absolute path of the bundled binary for this host, or null when this package deliberately has none
 * (musl, win32, other arches). Throws on a supported platform whose binary is missing: that is a corrupt
 * or partial install, not a platform the caller should silently fall back on.
 */
function tryBindingPath() {
	const file = SUPPORTED[platformKey()];
	if (!file || isMusl()) return null;
	const abs = path.join(__dirname, file);
	if (!fs.existsSync(abs)) throw new Error(`@owner/oxc-transform is missing ${file} for ${platformKey()} (incomplete or corrupt package at ${__dirname})`);
	return abs;
}

function bindingPath() {
	const p = tryBindingPath();
	if (!p) throw new Error(`@owner/oxc-transform has no binary for ${platformKey()}${isMusl() ? " (musl)" : ""}; supported: ${Object.keys(SUPPORTED).join(", ")}`);
	return p;
}

let cached;
/** The napi binding (moduleRunnerTransform, moduleRunnerTransformSync, transform, transformSync, isolatedDeclaration...). */
function loadBinding() {
	if (!cached) cached = require(bindingPath());
	return cached;
}

module.exports = { SUPPORTED, platformKey, tryBindingPath, bindingPath, loadBinding };
