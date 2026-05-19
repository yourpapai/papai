# OpenCode TPS Meter — Full Security Hardening + CI

**Date:** 2026-04-21
**Plugin:** `opencode-tps-meter` v0.2.1 (ChiR24)
**Scope:** All 15 findings from security audit (2 HIGH, 4 MEDIUM, 4 LOW, 5 INFO)
**Target:** Upstream-compatible patches applied locally first
**Approach:** Full security hardening + CI (Approach C)

---

## Context

The `opencode-tps-meter` plugin was cloned into `.opencode/plugins/opencode-tps-meter/` and audited. The plugin is a single-maintainer TypeScript project with 7 source files, 3 test files, a dual-format Bun build, and no CI pipeline. The audit found no critical vulnerabilities but identified operational security gaps in config loading, memory management, build integrity, dependency management, and project infrastructure.

---

## Section 1: Config Security Hardening (H1, M1, M3)

### H1 — Config file integrity

**File:** `config.ts:119–137` (`loadConfigFile`)

**Problem:** `JSON.parse()` output is checked for `typeof === "object"` but not validated against a schema or checked for structural integrity. A malicious `.opencode/tps-meter.json` in a world-writable directory would be silently loaded.

**Fix:**

1. Add `validateConfigShape()` that checks the parsed JSON is a plain object (`Object.getPrototypeOf(parsed) === Object.prototype`), rejects arrays, and validates all keys against a known allowlist matching the `Config` interface.

2. Add directory permission check: before loading a config file, verify the parent directory is not world-writable (`fs.statSync(parentDir).mode & 0o002 === 0`). If world-writable, skip the file and log a warning.

3. Reject the config file if it contains keys not in the `Config` interface allowlist.

### M1 — Prototype pollution

**File:** `config.ts:119–137`

**Problem:** `JSON.parse()` output is not checked for `Array.isArray`, and keys like `__proto__`, `constructor`, `prototype` are not stripped.

**Fix:**

1. Add `Array.isArray(parsed)` rejection in `loadConfigFile()`.

2. Add `sanitizeConfigKeys()` utility that strips `__proto__`, `constructor`, and `prototype` keys from the parsed object (single level only — the config schema is flat).

### M3 — Env var validation co-location

**File:** `config.ts:155–225` (`loadEnvConfig`)

**Problem:** Numeric env vars are parsed with raw `parseInt`/`parseFloat`, and validation is split between `loadEnvConfig()` (checks `isNaN`) and `mergeConfig()` (clamps). `parseFloat` accepts `"1e308"` and `Infinity`.

**Fix:**

1. Add `parseFiniteInt(value: string): number | null` — returns `null` for `NaN`, `Infinity`, `-Infinity`, non-integer values, and negative values.

2. Add `parseFiniteFloat(value: string): number | null` — same but allows floats.

3. Use these helpers in `loadEnvConfig()` and return `null` for invalid values, letting `mergeConfig()` fall through to defaults.

### New files

- `src/validation.ts` — `sanitizeConfigKeys()`, `validateConfigShape()`, `parseFiniteInt()`, `parseFiniteFloat()`
- `src/__tests__/validation.test.ts` — covers all edge cases

---

## Section 2: Memory Safety & Timer Lifecycle (M2, M4)

### M2 — Bounded Map with profiling phase

**File:** `index.ts:152–162`

**Problem:** Four maps (`partTextCache`, `messageTokenCache`, `messageRoleCache`, `messageAgentCache`) grow unbounded between cleanup cycles (30s intervals, 5min max age). In long-lived sessions with high throughput, these can accumulate significant memory.

**Fix:**

Introduce `BoundedMap<K, V>` in `src/bounded-map.ts` with two modes:

- **Monitor mode** (default): Logs a warning when `entries.size` exceeds a configurable `warnThreshold` per inner map. Does NOT evict. Logged metric includes session ID, map name, current size, and timestamp.
- **Enforce mode** (enabled later): Evicts oldest entry (FIFO) when `maxEntries` is hit.

The four maps get wrapped in monitor mode with `warnThreshold = 500` as an initial tripwire. After accumulating real session data, `maxEntries` per map will be set to 2-3x observed peaks and mode switched to enforce.

Maps and their warn thresholds:

- `partTextCache` — warn at 500 (part text is large)
- `messageTokenCache` — warn at 1000 (just numbers)
- `messageRoleCache` — warn at 1000 (just strings)
- `messageAgentCache` — warn at 500 (global, not per-session)

`sessionTrackers` and `sessionAgentNameCache` stay unbounded — keyed by session ID, naturally bounded by the OpenCode runtime.

### M4 — Timer leak

**File:** `index.ts:340–362` (`scheduleDisplayTimer`), `ui.ts:196–207` (`scheduleFlush`)

**Problem:** `setTimeout` timers created by `scheduleDisplayTimer` and `scheduleFlush` may leak if the plugin error handler catches an exception between timer creation and cleanup.

**Fix:**

Add `TimerRegistry` class in `src/timer-registry.ts`:

- Tracks all `setTimeout` handles with labels for debugging
- `register(label: string, handle: ReturnType<typeof setTimeout>): void`
- `clear(label: string): void`
- `clearAll(): void`
- Installs a single `process.on('exit')` handler that calls `clearAll()`

Replace ad-hoc `pendingDisplayTimers` map in `index.ts` and `flushTimer` variable in `ui.ts` with the unified registry. The `TimerRegistry` instance is created in `index.ts` during plugin initialization and passed to `createUIManager()` as a parameter. Call `timerRegistry.clearAll()` from `cleanup()` and `handleSessionIdle()`.

### New files

- `src/bounded-map.ts` — `BoundedMap<K, V>` with monitor/enforce modes
- `src/timer-registry.ts` — `TimerRegistry` class
- `src/__tests__/bounded-map.test.ts`
- `src/__tests__/timer-registry.test.ts`

---

## Section 3: Build System Hardening (H2)

### H2 — CJS build post-processing integrity

**File:** `build.ts:46–60`

**Problem:** The build script performs a regex replacement on the generated CJS output (`module\.exports = __toCommonJS\(exports_src\)`). If the Bun bundler changes its internal variable naming, the replacement silently fails and the plugin exports the wrong shape. This is a supply-chain integrity risk.

**Fix:**

1. **Anchor-based replacement** — instead of matching the exact `__toCommonJS(exports_src)` string, search for any line starting with `module.exports =` and replace the entire line with the correct export. This survives internal variable renames.

2. **Post-build assertion** — after writing the CJS file:
   - Verify the file contains `module.exports` exactly once in a top-level assignment (no duplicates from failed replacements)
   - Spawn a child process that `require()`s the built file and checks `typeof result === "function"` and `typeof result.default === "function"`
   - If validation fails, delete the output files and exit with code 1 and a clear error message

3. **Checksum recording** — after a successful build, write `dist/.checksums.json` containing SHA-256 hashes of `index.js` and `index.mjs`. Include this file in the npm package. Consumers or CI can verify published artifacts match the source.

### New files

- `src/__tests__/build.test.ts` — tests build output shape, validation assertions, checksum generation. Gated behind `BUILD_TEST` env var since it requires `Bun.build()`.

---

## Section 4: Code Quality & Type Safety (L1, L4)

### L1 — Toast message sanitization

**File:** `ui.ts:140–190`

**Problem:** Toast messages interpolate values derived from OpenCode events (message IDs, agent labels) without sanitization. While currently internal-only, ANSI escape sequences or control characters in message IDs would flow into toast output.

**Fix:**

Add `sanitizeForDisplay()` in `src/sanitize.ts`:

- Strips ANSI escape sequences (`\x1b[...m`, `\x1b[...H`, etc.)
- Strips control characters below `\x20` except `\n` and `\t`
- Truncates strings longer than 500 characters with a `…` indicator

Apply to `agent.label` and any ID-derived strings before they enter toast messages in `ui.ts`.

### L4 — Remove `(part as any).reasoning` cast

**File:** `index.ts:48`, `types.ts` (Part interface)

**Fix:**

Add `reasoning?: string` to the `Part` interface in `types.ts`. Replace `(part as any).reasoning` with `part.reasoning` in `index.ts:48`.

### New files

- `src/sanitize.ts` — `sanitizeForDisplay()`
- `src/__tests__/sanitize.test.ts`

---

## Section 5: Dependency Pinning & Supply Chain (L2, L3, I4)

### L2 — Pin runtime dependency

**File:** `package.json`

**Fix:**

Move `@opencode-ai/plugin` from `dependencies` to `peerDependencies` with range `">=1.0.0"`. Add it to `devDependencies` at exact version `"1.14.18"` (matching papai project) for local development and testing. This prevents a compromised minor/patch release from being auto-installed while keeping the plugin compatible with any OpenCode version.

### L3 — Reproducible builds

**Fix:**

1. Ensure `bun.lock` is tracked in git (already is). `bun.lock` is not currently excluded by `.npmignore` so no change needed there — just verify it stays that way.

2. Add `scripts/verify-build.sh`:
   - Run `bun install` from lockfile
   - Run `bun run build`
   - Compare output checksums against `dist/.checksums.json`
   - Exit 0 if match, exit 1 if mismatch

### I4 — Pin dev dependencies

**Fix:**

Pin `typescript` and `@types/node` to exact versions in `package.json` (remove caret ranges).

---

## Section 6: CI Pipeline & Security Policy (I1, I2, I3)

### I1 — SECURITY.md

Add `SECURITY.md` at repo root:

- Supported versions (currently v0.2.x)
- How to report: GitHub Security Advisories
- Response timeline: acknowledge within 48h, fix within 7 days (HIGH), 30 days (MEDIUM), next release (LOW)
- Disclosure policy: coordinated disclosure after fix is released

### I2 — Single maintainer acknowledgment

Document in `SECURITY.md` that the project has a single maintainer. Suggest critical users fork and maintain their own patches if response times are insufficient.

### I3 — CI workflows

Three GitHub Actions workflows:

1. **`.github/workflows/ci.yml`** — on push and PR:
   - `bun install` from lockfile
   - `bun test`
   - `bun run build`
   - Build checksum verification (`scripts/verify-build.sh`)
   - TypeScript type checking (`bunx tsc --noEmit`)

2. **`.github/workflows/security.yml`** — weekly schedule + push to main:
   - `npm audit`
   - Trivy filesystem scan
   - Verify `bun.lock` is committed and matches `package.json`
   - Grep check: no `console.*` calls in `src/`

3. **`.github/workflows/publish.yml`** — on release publish:
   - Full CI checks first (reuse ci.yml via workflow_call)
   - Build with checksums
   - `npm publish --provenance`
   - Verify published tarball matches built artifacts

**Dependabot:** `.github/dependabot.yml`:

- `npm` ecosystem, weekly
- `github-actions` ecosystem, weekly
- Auto-assign to repo maintainer

---

## Section 7: API Cleanup (I5)

### I5 — Remove misleading `encodeText()`

**File:** `tokenCounter.ts:139–143`

**Problem:** `encodeText()` always returns `[]` with a comment "placeholder for compatibility." No consumer uses it. It's exported but is a no-op lie — any consumer depending on it was already broken.

**Fix:**

Remove `encodeText()` from `tokenCounter.ts`. Add a note in `RELEASE_NOTES.md` documenting the removal. This is a minor breaking change to the public API surface but justified since the function was never functional.

---

## Files Changed Summary

### New files (11)

- `src/validation.ts`
- `src/sanitize.ts`
- `src/bounded-map.ts`
- `src/timer-registry.ts`
- `src/__tests__/validation.test.ts`
- `src/__tests__/sanitize.test.ts`
- `src/__tests__/bounded-map.test.ts`
- `src/__tests__/timer-registry.test.ts`
- `src/__tests__/build.test.ts`
- `scripts/verify-build.sh`
- `SECURITY.md`

### Modified files (9)

- `src/config.ts` — use validation helpers, sanitize keys, check directory permissions
- `src/index.ts` — use BoundedMap, TimerRegistry, remove `as any` cast, add `reasoning` to Part usage
- `src/types.ts` — add `reasoning?: string` to Part interface
- `src/ui.ts` — sanitize display strings, use TimerRegistry
- `src/tokenCounter.ts` — remove `encodeText()`
- `build.ts` — anchor-based replacement, post-build validation, checksum recording
- `package.json` — pin deps, move `@opencode-ai/plugin` to peerDependencies
- `RELEASE_NOTES.md` — document `encodeText()` removal

### New CI files (4)

- `.github/workflows/ci.yml`
- `.github/workflows/security.yml`
- `.github/workflows/publish.yml`
- `.github/dependabot.yml`

---

## Implementation Order

1. New utility modules (validation, sanitize, bounded-map, timer-registry) + their tests
2. Config security hardening (H1, M1, M3)
3. Memory safety & timer lifecycle (M2, M4)
4. Build system hardening (H2)
5. Code quality fixes (L1, L4)
6. Dependency pinning (L2, L3, I4)
7. API cleanup (I5)
8. CI workflows & SECURITY.md (I1, I2, I3)
9. Integration test pass — verify all existing tests still pass with the changes
