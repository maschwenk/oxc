import type * as Binding from "./binding.js";
export type PlatformKey = "linux-x64" | "linux-arm64" | "darwin-arm64" | "darwin-x64";
export declare const SUPPORTED: Record<PlatformKey, string>;
export declare function platformKey(): string;
/** Absolute path of the bundled .node for this host; null when unsupported (musl, win32, other arches); throws when a supported platform's binary is missing. */
export declare function tryBindingPath(): string | null;
export declare function bindingPath(): string;
export declare function loadBinding(): typeof Binding;
