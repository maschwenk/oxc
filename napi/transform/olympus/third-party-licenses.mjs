#!/usr/bin/env node
// Bundle full license/notice texts for every crate linked into oxc_transform_napi.
//   node third-party-licenses.mjs --out THIRD_PARTY_LICENSES.txt [--manifest-path <oxc>/Cargo.toml] [--allow-missing a,b]
// Package set: `cargo tree -p oxc_transform_napi --features allocator -e normal --target all` (what actually links,
// on every shipped target). Metadata (license, license_file, manifest_path, source): `cargo metadata`.
// Text resolution, per crate: license_file from Cargo.toml, else LICENSE*/LICENCE*/COPYING*/NOTICE* in the crate
// root, else (path crates only) the nearest ancestor directory up to the workspace root holding such files.
// Crates that ship no text fall back to license-overrides/<name>.LICENSE (copied from the project repository;
// provenance in license-overrides/SOURCES.txt) and are marked as such. Anything still unresolved fails the run
// unless named in --allow-missing, in which case it is listed as declared-license-without-text.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = {};
for (let i = 2; i < process.argv.length; i++) {
	const a = process.argv[i];
	if (!a.startsWith("--")) continue;
	const next = process.argv[i + 1];
	args[a.slice(2)] = next === undefined || next.startsWith("--") ? true : (i++, next);
}
const out = typeof args.out === "string" ? args.out : "THIRD_PARTY_LICENSES.txt";
const manifest = typeof args["manifest-path"] === "string" ? path.resolve(args["manifest-path"]) : undefined;
const allowMissing = new Set(typeof args["allow-missing"] === "string" ? args["allow-missing"].split(",").filter(Boolean) : []);
const ROOT = "oxc_transform_napi";
const overridesDir = typeof args.overrides === "string" ? path.resolve(args.overrides) : path.join(path.dirname(fileURLToPath(import.meta.url)), "license-overrides");
const overrideSources = new Map();
try {
	for (const line of readFileSync(path.join(overridesDir, "SOURCES.txt"), "utf8").split("\n")) {
		const m = line.match(/^(\S+)\s+(https?:\S+)/);
		if (m) overrideSources.set(m[1], m[2]);
	}
} catch {}
const cargo = (cmdArgs) => execFileSync("cargo", [...cmdArgs, ...(manifest ? ["--manifest-path", manifest] : [])], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "inherit"] });

const tree = cargo(["tree", "-p", ROOT, "--features", "allocator", "-e", "normal", "--target", "all", "--prefix", "none", "--format", "{p}", "--locked"]);
const wanted = new Map(); // "name vX.Y.Z" -> true
for (const line of tree.split("\n")) {
	const m = line.match(/^(\S+) v(\S+)/);
	if (m) wanted.set(`${m[1]} v${m[2]}`, true);
}
if (!wanted.size) throw new Error("cargo tree returned no packages");

const meta = JSON.parse(cargo(["metadata", "--format-version", "1", "--locked"]));
const workspaceRoot = meta.workspace_root;
const byKey = new Map(meta.packages.map((p) => [`${p.name} v${p.version}`, p]));
const LICENSE_RE = /^(LICEN[CS]E|COPYING|NOTICE|COPYRIGHT)([-._].*)?$/i;

function licenseFilesIn(dir) {
	try {
		return readdirSync(dir)
			.filter((f) => LICENSE_RE.test(f) && statSync(path.join(dir, f)).isFile())
			.sort()
			.map((f) => path.join(dir, f));
	} catch {
		return [];
	}
}

function resolveTexts(pkg) {
	const crateDir = path.dirname(pkg.manifest_path);
	if (pkg.license_file) {
		const p = path.resolve(crateDir, pkg.license_file);
		if (existsSync(p)) return [p];
	}
	let files = licenseFilesIn(crateDir);
	if (files.length) return files;
	// path/workspace crates: inherit from an ancestor inside the workspace (oxc crates use the root LICENSE)
	if (pkg.source === null || pkg.source === undefined) {
		let dir = path.dirname(crateDir);
		const stop = path.dirname(workspaceRoot);
		while (dir !== stop && dir.startsWith(workspaceRoot)) {
			files = licenseFilesIn(dir);
			if (files.length) return files;
			dir = path.dirname(dir);
		}
	}
	return [];
}

const sections = [];
const missing = [];
const index = [];
for (const key of [...wanted.keys()].sort()) {
	const pkg = byKey.get(key);
	if (!pkg) throw new Error(`${key} is in cargo tree but not in cargo metadata`);
	let files = resolveTexts(pkg);
	let overrideNote = "";
	if (!files.length) {
		const o = path.join(overridesDir, `${pkg.name}.LICENSE`);
		if (existsSync(o)) {
			files = [o];
			overrideNote = ` [text not in crate; copied from ${overrideSources.get(pkg.name) ?? "project repository"}, see license-overrides/SOURCES.txt]`;
		}
	}
	const local = !pkg.source;
	const header = `${pkg.name} ${pkg.version}  license: ${pkg.license ?? "(unspecified)"}  source: ${local ? "workspace" : pkg.source}${pkg.repository ? `  repository: ${pkg.repository}` : ""}`;
	if (!files.length) {
		if (allowMissing.has(pkg.name)) {
			index.push(`${header}  [NO LICENSE TEXT IN CRATE; allowed by --allow-missing]`);
			sections.push(`${"=".repeat(100)}\n${header}\n\nNo license text ships with this crate; see its repository. Declared license: ${pkg.license ?? "(unspecified)"}.\n`);
			continue;
		}
		missing.push(header);
		continue;
	}
	index.push(`${header}  files: ${files.map((f) => path.basename(f)).join(", ")}${local ? ` (inherited from ${path.relative(workspaceRoot, path.dirname(files[0])) || "workspace root"})` : ""}${overrideNote}`);
	const body = files.map((f) => `--- ${path.basename(f)} ---\n${readFileSync(f, "utf8").replace(/\r\n/g, "\n").trimEnd()}\n`).join("\n");
	sections.push(`${"=".repeat(100)}\n${header}${overrideNote}\n\n${body}`);
}

if (missing.length) {
	console.error(`license text not found for ${missing.length} crate(s):\n  ${missing.join("\n  ")}\nPass --allow-missing <name,...> only after checking each crate's repository.`);
	process.exit(1);
}

const rootPkg = [...byKey.values()].find((p) => p.name === ROOT);
const banner = [
	`Third-party licenses for ${ROOT} ${rootPkg?.version ?? ""} (features: allocator), all shipped targets.`,
	`${wanted.size} crates resolved via cargo tree + cargo metadata; full notice texts follow the index.`,
	`oxc itself is MIT (LICENSE); oxc's vendored third-party notices are in THIRD-PARTY-LICENSE.`,
	"",
	"INDEX",
	...index,
	"",
].join("\n");
mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
writeFileSync(out, `${banner}\n${sections.join("\n")}`);
console.log(`wrote ${out}: ${wanted.size} crates, ${sections.length} sections, ${missing.length} missing`);
