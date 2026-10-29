import { describe, expect, test } from "vitest";
import { ModuleRunnerExportMode, moduleRunnerTransform, moduleRunnerTransformSync } from "../index";

describe("moduleRunnerTransformSync", () => {
  test("dynamic import", async () => {
    const result = moduleRunnerTransformSync("index.js", `export const i = () => import('./foo')`);
    expect(result?.code).toMatchInlineSnapshot(`
      "Object.defineProperty(__vite_ssr_exports__, "i", {
      	enumerable: true,
      	configurable: true,
      	get() {
      		return i;
      	}
      });
      const i = () => __vite_ssr_dynamic_import__("./foo");
      "
    `);
    expect(result?.deps).toEqual([]);
    expect(result?.dynamicDeps).toEqual(["./foo"]);
  });

  test("exportMode: ExportName emits Vite's __vite_ssr_exportName__ getters", () => {
    const result = moduleRunnerTransformSync("index.js", `export const a = 1`, {
      exportMode: ModuleRunnerExportMode.ExportName,
    });
    expect(result?.code).toMatchInlineSnapshot(`
      "__vite_ssr_exportName__("a", () => {
      	try {
      		return a;
      	} catch {}
      });
      const a = 1;
      "
    `);
    expect(result?.errors).toEqual([]);
  });

  test("exportMode: ExportName getters return undefined during the temporal dead zone", async () => {
    const { code } = moduleRunnerTransformSync("index.js", `export const a = 1`, {
      exportMode: ModuleRunnerExportMode.ExportName,
    });
    const getters: Record<string, () => unknown> = {};
    const readsBeforeInit: unknown[] = [];
    const exportName = (name: string, getter: () => unknown) => {
      getters[name] = getter;
      readsBeforeInit.push(getter());
    };
    const AsyncFunction = (async () => {}).constructor as new (
      ...args: string[]
    ) => (...args: unknown[]) => Promise<void>;
    await new AsyncFunction("__vite_ssr_exportName__", code)(exportName);

    expect(readsBeforeInit).toEqual([undefined]);
    expect(getters.a()).toBe(1);
  });

  test("sourcemap", async () => {
    const map = moduleRunnerTransformSync("index.js", `export const a = 1`, {
      sourcemap: true,
    })?.map;

    expect(map).toMatchInlineSnapshot(`
      {
        "mappings": ";;;;;;;AAAO,MAAM,IAAI",
        "names": [],
        "sources": [
          "index.js",
        ],
        "sourcesContent": [
          "export const a = 1",
        ],
        "version": 3,
      }
    `);
  });
});

describe("moduleRunnerTransform", () => {
  test("produces same result as sync", async () => {
    const syncResult = moduleRunnerTransformSync("index.js", `export const a = 1`);
    const asyncResult = await moduleRunnerTransform("index.js", `export const a = 1`);

    expect(asyncResult.code).toEqual(syncResult.code);
    expect(asyncResult.deps).toEqual(syncResult.deps);
    expect(asyncResult.dynamicDeps).toEqual(syncResult.dynamicDeps);
    expect(asyncResult.errors.length).toBe(syncResult.errors.length);
  });
});
