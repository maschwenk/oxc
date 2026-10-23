# @owner/oxc-transform distribution kit

Everything needed to build and ship the patched `oxc-transform` 0.147.0 binding (moduleRunnerTransform
`exportMode: "ExportName"` + parenthesized-callee fix) as a checksum-pinned GitHub release tarball.
Nothing here has been pushed, run in CI, or released. Local checks run so far are listed at the end.

## Files

```
branch-files/                                  copy onto a NEW branch of maschwenk/oxc (apply.sh)
  .github/workflows/olympus-transform-binding.yml   build 4 targets, verify, assemble, upload artifacts
  napi/transform/olympus/loader.cjs            ships as package index.cjs (tryBindingPath / bindingPath / loadBinding)
  napi/transform/olympus/loader.d.cts          ships as package index.d.cts
  napi/transform/olympus/package-binding.mjs   artifacts dir -> package dir (release mode enforces provenance)
  napi/transform/olympus/smoke.mjs             dependency-free semantic smoke test (CI + local)
  napi/transform/olympus/third-party-licenses.mjs   full license/notice text per linked crate (cargo tree + metadata)
  napi/transform/olympus/license-overrides/    texts for crates that ship none (provenance in SOURCES.txt)
apply.sh                                       stage branch-files in the oxc checkout on a new branch; no commit
assemble-release.sh                            download bundle artifact, verify, print/perform release commands
```

## Build matrix and portability

| target | runner | how | smoke |
|---|---|---|---|
| x86_64-unknown-linux-gnu | ubuntu-latest | `pnpm build --use-napi-cross` (napi-rs cross toolchain, glibc 2.17) | host |
| aarch64-unknown-linux-gnu | ubuntu-latest | same cross toolchain | qemu-user-static + `node:22-bookworm-slim` |
| aarch64-apple-darwin | macos-15 (arm64) | native | host |
| x86_64-apple-darwin | macos-15-intel (x64) | native | host |

Linux binaries are the same portable-glibc flavour upstream publishes; a `readelf -V` step fails the job if any
`GLIBC_x.y` symbol version exceeds `OLYMPUS_MAX_GLIBC` (2.28). Owner Buildkite queues are x86 (`aws-t3-*`,
`cd-xlarge-x86`) plus EKS queues that are mostly Graviton, so both Linux arches ship. musl, Windows and other
arches are not built; the loader returns `null` there.

## Package contents (`package/` in the tarball)

`index.cjs`, `index.d.cts`, `binding.d.ts` (napi typings incl. `exportMode`), `package.json`
(`@owner/oxc-transform`, no `os`/`cpu` gate, no scripts), four `transform.*.node`, `LICENSE` (oxc MIT),
`THIRD-PARTY-LICENSE` (upstream notice texts, verbatim), `THIRD_PARTY_LICENSES.txt` (name, version, declared
license, source and the full notice text of all 128 crates linked on any shipped target), `BUILD.json` (per binary: source sha, ref, run id, rustc, napi cli, target,
sha256, max glibc, smoke kind), `SHA256SUMS`.

Loader contract: `tryBindingPath()` returns the absolute `.node` path, `null` on unsupported hosts, and throws
if a supported host's binary is missing. Olympus keys its Vite plugin on the binary's sha256 (from `BUILD.json`
or hashing the path) plus an adapter revision.

Per-platform archives `oxc-transform-<platform>-<version>.tgz` (binary + provenance + licenses) and
`RELEASE.txt` (source sha, tarball sha256, pnpm `integrity`) sit next to the package tarball in the
`olympus-oxc-transform-bundle` artifact.

## Commands (parent runs; none executed here)

```bash
# 1. stage on a new branch of the fork checkout, after the final native commit lands
OXC=/tmp/olympus-native-engine/oxc BRANCH=olympus/transform-binding-ci bash /tmp/olympus-native-distribution/apply.sh
git -C /tmp/olympus-native-engine/oxc commit -m "ci(olympus): build @owner/oxc-transform binaries for linux/macos x64+arm64"
git -C /tmp/olympus-native-engine/oxc remote add fork https://github.com/maschwenk/oxc.git
git -C /tmp/olympus-native-engine/oxc push -u fork olympus/transform-binding-ci     # push triggers the workflow

# 2. watch, then download + verify (checks run headSha == RELEASE.txt source, SHA256SUMS, integrity, local smoke)
gh run list -R maschwenk/oxc -w olympus-transform-binding.yml -L 3
RUN_ID=<id> bash /tmp/olympus-native-distribution/assemble-release.sh

# 3. release (prints the exact tag/push/gh release create commands; PUBLISH=1 executes them)
RUN_ID=<id> PUBLISH=1 bash /tmp/olympus-native-distribution/assemble-release.sh

# 4. Owner: devDependency pinned by URL; pnpm records tarball + integrity in pnpm-lock.yaml
#   "@owner/oxc-transform": "https://github.com/maschwenk/oxc/releases/download/owner-oxc-transform-v0.147.0-owner.1/owner-oxc-transform-0.147.0-owner.1.tgz"
```

Local verification of any binary or package dir, at any time:
`node branch-files/napi/transform/olympus/smoke.mjs /tmp/olympus-native-engine/dist/oxc-transform-patched/transform.darwin-arm64.node`

## Caveats

- Source sha changes: nothing is hardcoded to 4b763f4. Rebase/cherry-pick the branch onto the final native
  commit; `BUILD.json`, `RELEASE.txt` and the release tag all take the sha from the run.
- Version bump: edit `OLYMPUS_PACKAGE_VERSION` in the workflow and pass `VERSION=` to assemble-release.sh.
- `oxc-project/setup-node` installs the whole oxc pnpm workspace (upstream does the same). Linux cross builds
  need `@napi-rs/cross-toolchain`, already in the fork's lockfile.
- qemu smoke installs `qemu-user-static` from Ubuntu and pulls `node:22-bookworm-slim`, each with 3 retries,
  and checks the arm64 binfmt handler is registered before running.
- License texts: 9 crates (napi*, Nugine simd, lazy-regex-proc_macros, oxc-browserslist, oxc_index) declare
  MIT but ship no text in the crate archive; their texts were copied from the project repositories into
  `license-overrides/` and are marked as such. `json-escape-simd` 3.1.0 has no text in the crate or its
  repository, so it is listed as declared-MIT without text via `--allow-missing json-escape-simd`. Any other
  unresolved crate fails the job.
- Pinned action SHAs are copied from upstream `reusable_release_napi.yml`; no new third-party actions.
- Fork `main` and existing branches are untouched; the workflow triggers only on `olympus/**` branches and
  manual dispatch. It never publishes to npm and needs no repository secrets.

## Local checks already run (2026-10-23, this machine)

- `third-party-licenses.mjs` against the clone: 128 crates, 128 sections, 0 missing with the one allowance;
  exits 1 naming `json-escape-simd` without it. Output kept at `local-test/THIRD_PARTY_LICENSES.txt` (957 KB).
- Assembler with the real darwin-arm64 binary plus synthetic metadata for the other three: partial mode works;
  release mode fails on a missing binary, missing license file, mismatched `--source-sha`, and a tampered binary;
  full release assembly produces the expected 13-file package and the `package/` tarball layout.
- `smoke.mjs` passed through the shipped loader on the real binary (ExportName hoisting, `(0, ns.f)()` callees,
  deps, sourcemap, errors). Consumed from a consumer `node_modules/@owner/oxc-transform` via both `require`
  and ESM `import`; loader returns null for win32 and throws for a missing darwin-x64 binary.
- Not run: any cargo build, pnpm install, or the workflow itself.
