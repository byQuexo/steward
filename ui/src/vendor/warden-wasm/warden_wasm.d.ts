/* tslint:disable */
/* eslint-disable */

export class Scope {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Decide. `action_json` is parsed strictly; a malformed action is a `deny`, not an exception.
     */
    check(principal_json: string, action_json: string, context_json?: string | null): string;
    effectiveScopes(principal_json: string): string;
    constructor(policy_yaml: string, catalog_yaml: string, lock_json?: string | null);
    version(): string;
    visible(principal_json: string, action_json: string, context_json?: string | null): boolean;
    warnings(): string;
}

/**
 * Validate an identity config and list its issuers (used by the TS verifier).
 */
export function identityIssuers(identity_yaml: string): string;

export function lint(policy_yaml: string, catalog_yaml: string): string;

/**
 * Map verified claims to a principal. Returns `{"ok": principal}` or `{"error": {code, message}}`.
 */
export function principalFromClaims(identity_yaml: string, claims_json: string, now: number): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_scope_free: (a: number, b: number) => void;
    readonly identityIssuers: (a: number, b: number, c: number) => void;
    readonly lint: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly principalFromClaims: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly scope_check: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly scope_effectiveScopes: (a: number, b: number, c: number, d: number) => void;
    readonly scope_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly scope_version: (a: number, b: number) => void;
    readonly scope_visible: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly scope_warnings: (a: number, b: number) => void;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export4: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
