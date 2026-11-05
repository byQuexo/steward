// Rebuild src/vendor/warden-wasm from the Warden commit Steward pins (Cargo.toml).
//   WARDEN_DIR=../path/to/warden node scripts/build-warden-wasm.mjs
// Needs: rustup target add wasm32-unknown-unknown, wasm-bindgen-cli 0.2.130.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ui = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rev = /warden", rev = "([0-9a-f]{40})"/.exec(readFileSync(path.join(ui, '../Cargo.toml'), 'utf8'))?.[1];
if (!rev) throw new Error('no Warden rev in Cargo.toml');
const warden = process.env.WARDEN_DIR;
if (!warden) throw new Error('set WARDEN_DIR to a Warden checkout');
execFileSync('git', ['checkout', rev], { cwd: warden, stdio: 'inherit' });
execFileSync('cargo', ['build', '--profile', 'wasm', '--target', 'wasm32-unknown-unknown', '-p', 'warden-wasm'], { cwd: warden, stdio: 'inherit' });
const target = process.env.CARGO_TARGET_DIR || path.join(warden, 'target');
const wasm = path.join(target, 'wasm32-unknown-unknown', 'wasm', 'warden_wasm.wasm');
execFileSync('wasm-bindgen', ['--target', 'web', '--out-dir', path.join(ui, 'src/vendor/warden-wasm'), wasm], { stdio: 'inherit' });
console.log(`warden-wasm @ ${rev} written to src/vendor/warden-wasm`);
