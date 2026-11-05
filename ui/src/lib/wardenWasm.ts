// Warden's engine compiled to WebAssembly (built from the pinned Warden commit by
// scripts/build-warden-wasm.mjs). The console's what-if runs here, in the browser, with the
// same code the gateway runs; the server answer is used as a cross-check.
import init, { Scope } from '@/vendor/warden-wasm/warden_wasm.js';
import wasmUrl from '@/vendor/warden-wasm/warden_wasm_bg.wasm?url';
import type { KillMode, Principal, WhatIfResult } from './types';

let ready: Promise<unknown> | null = null;
const scopes = new Map<string, Scope>();

async function scope(policyYaml: string, catalogYaml: string): Promise<Scope> {
  ready ??= init({ module_or_path: wasmUrl });
  await ready;
  const key = `${policyYaml.length}:${catalogYaml.length}:${policyYaml.slice(0, 64)}`;
  let s = scopes.get(key);
  if (!s) {
    s = new Scope(policyYaml, catalogYaml, undefined);
    scopes.set(key, s);
  }
  return s;
}

/** Decide `action` for `principal` with Warden in the browser, including the full trace. */
export async function explainInBrowser(
  policyYaml: string,
  catalogYaml: string,
  principal: Principal,
  action: { kind: string; name: string; args: unknown },
  killSwitch: KillMode = 'off',
): Promise<WhatIfResult> {
  const s = await scope(policyYaml, catalogYaml);
  const out = s.check(JSON.stringify(principal), JSON.stringify(action), JSON.stringify({ kill_switch: killSwitch }));
  return JSON.parse(out) as WhatIfResult;
}
