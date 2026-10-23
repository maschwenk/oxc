#!/usr/bin/env node
// Dependency-free smoke test for the Olympus oxc-transform build.
//   node smoke.mjs <path>   where <path> is a .node binary or an assembled package dir (index.cjs + transform.*.node)
// Covers the two fork changes (moduleRunnerTransform `exportMode: "ExportName"`, `(0, ns.x)` for parenthesized
// callees) plus the unchanged contract Vite's ssrTransform relies on (deps, dynamicDeps, sourcemap, errors).
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { statSync } from "node:fs";
import path from "node:path";

const target = process.argv[2] ?? process.env.OLYMPUS_NATIVE_OXC_BINDING;
if (!target) {
	console.error("usage: node smoke.mjs <binding.node | package dir>");
	process.exit(2);
}

function load(location) {
	const abs = path.resolve(location);
	if (abs.endsWith(".node")) {
		const require = createRequire(path.join(path.dirname(abs), "noop.js"));
		return { kind: "binary", file: abs, api: require(abs) };
	}
	if (!statSync(abs).isDirectory()) throw new Error(`${abs} is neither a .node file nor a package dir`);
	// the shipped loader: index.cjs resolves transform.<platform>.node next to itself
	const loader = createRequire(path.join(abs, "noop.js"))(path.join(abs, "index.cjs"));
	const file = loader.bindingPath();
	assert.equal(loader.tryBindingPath(), file);
	assert.ok(statSync(file).isFile(), `${file} missing`);
	return { kind: "loader", file, api: loader.loadBinding() };
}

const { kind, file, api } = load(target);
assert.equal(typeof api.moduleRunnerTransformSync, "function", "moduleRunnerTransformSync missing");
assert.equal(typeof api.moduleRunnerTransform, "function", "moduleRunnerTransform missing");
const t = (code, opts, name = "x.mjs") => api.moduleRunnerTransformSync(name, code, opts);
let r;

// 1. default mode is unchanged (Object.defineProperty getters), explicitly and implicitly
for (const opts of [undefined, {}, { exportMode: "DefineProperty" }]) {
	r = t("export const a = 1", opts);
	assert.deepEqual(r.errors, []);
	assert.match(r.code, /Object\.defineProperty\(__vite_ssr_exports__, "a"/);
	assert.doesNotMatch(r.code, /__vite_ssr_exportName__/);
}

// 2. ExportName mode: Vite 7+/8 getter shape, hoisted after directives and before imports
r = t(`"use strict";\nimport { foo } from "vue";\nexport const a = foo;`, { exportMode: "ExportName" });
assert.deepEqual(r.errors, []);
{
	const lines = r.code.trim().split("\n");
	assert.equal(lines[0], `"use strict";`, r.code);
	assert.match(lines[1], /^__vite_ssr_exportName__\("a", \(\) => \{$/, r.code);
	assert.match(r.code, /try \{\s*return a;\s*\} catch \{\}/);
	assert.ok(r.code.indexOf("__vite_ssr_exportName__") < r.code.indexOf("__vite_ssr_import__"), "exportName must be hoisted above imports");
	assert.match(r.code, /const __vite_ssr_import_0__ = await __vite_ssr_import__\("vue", \{ importedNames: \["foo"\] \}\);/);
	assert.doesNotMatch(r.code, /Object\.defineProperty/);
}

// 3. ExportName covers every export form Olympus code uses
r = t(
	[
		`import { x } from "dep";`,
		`export default function main() {}`,
		`const local = 1;`,
		`export { local as renamed, x as reexported };`,
		`export class C {}`,
		`export let mut = 2;`,
		`export * from "star";`,
		`export * as ns from "nsdep";`,
	].join("\n"),
	{ exportMode: "ExportName" },
);
assert.deepEqual(r.errors, []);
for (const name of ["default", "renamed", "reexported", "C", "mut", "ns"]) {
	assert.match(r.code, new RegExp(`__vite_ssr_exportName__\\("${name}", \\(\\) => \\{`), `missing exportName for ${name}\n${r.code}`);
}
assert.match(r.code, /__vite_ssr_exportAll__\(__vite_ssr_import_\d+__\);/);
assert.doesNotMatch(r.code, /Object\.defineProperty/);
assert.deepEqual([...r.deps].sort(), ["dep", "nsdep", "star"]);

// 4. parenthesized / optional callee keeps `this` unbound: (foo)() must become (0, ns.foo)(), never ns.foo()
r = t(`import { foo } from "vue"; (foo)(); ((foo))(); (foo)?.(); foo(); obj.foo(); new (foo)();`);
assert.deepEqual(r.errors, []);
{
	const calls = r.code.split("\n").filter((l) => l.includes("__vite_ssr_import_0__.foo") && !l.startsWith("new "));
	assert.equal(calls.length, 4, r.code);
	for (const l of calls) assert.match(l, /^\(+0, __vite_ssr_import_0__\.foo\)+\??\.?\(\);$/, r.code);
	assert.match(r.code, /^\(+0, __vite_ssr_import_0__\.foo\)+\?\.\(\);$/m, r.code);
	assert.match(r.code, /new \(?__vite_ssr_import_0__\.foo\)?\(\);/, r.code);
	assert.match(r.code, /^obj\.foo\(\);$/m, r.code);
	assert.doesNotMatch(r.code, /^__vite_ssr_import_0__\.foo\(\)/m, "bare member call would bind `this` to the namespace");
}
// same with ExportName on, and default-import callee
r = t(`import def, { foo } from "vue"; export const a = (foo)(); (def)();`, { exportMode: "ExportName" });
assert.deepEqual(r.errors, []);
assert.match(r.code, /\(0, __vite_ssr_import_0__\.foo\)\(\)/, r.code);
assert.match(r.code, /\(0, __vite_ssr_import_0__\.default\)\(\)/, r.code);

// 5. deps / dynamicDeps / sourcemap / import.meta contract
r = t(`import a from "a"; export * from "b"; const c = () => import("c"); import.meta.url;`, { sourcemap: true, exportMode: "ExportName" });
assert.deepEqual(r.errors, []);
assert.deepEqual([...r.deps].sort(), ["a", "b"]);
assert.deepEqual(r.dynamicDeps, ["c"]);
assert.ok(r.map && typeof r.map.mappings === "string" && r.map.mappings.length > 0, "sourcemap missing");
assert.match(r.code, /__vite_ssr_import_meta__\.url/);
assert.match(r.code, /__vite_ssr_dynamic_import__\("c"\)/);

// 6. errors surface instead of throwing; empty module is fine; unknown exportMode is rejected
r = t("export const = 1");
assert.ok(r.errors.length > 0 && r.errors[0].severity === "Error", "parse error should be reported");
r = t("", { exportMode: "ExportName" });
assert.deepEqual(r.errors, []);
assert.throws(() => t("export const a = 1", { exportMode: "Bogus" }), /Bogus|exportMode|invalid|variant/i);

// 7. async API agrees with sync
{
	const a = await api.moduleRunnerTransform("x.mjs", "export const a = 1", { exportMode: "ExportName" });
	assert.equal(a.code, t("export const a = 1", { exportMode: "ExportName" }).code);
}

console.log(`smoke ok (${kind}): ${file} [node ${process.version} ${process.platform}-${process.arch}]`);
