# ADR-0113: OpenCode TPS Meter Security Hardening — All 15 Audit Findings

## Status

Accepted

## Date

2026-04-21

## Context

The `opencode-tps-meter` plugin was cloned into `.opencode/plugins/opencode-tps-meter/` and subjected to a security audit. The plugin is a single-maintainer TypeScript project with 7 source files, 3 test files, a dual-format Bun build, and no CI pipeline at the time of audit. The audit found no critical vulnerabilities but identified 15 operational-security gaps: 2 HIGH, 4 MEDIUM, 4 LOW, and 5 INFO.

The audit categories:

- **HIGH (H1, H2)**: Config file integrity from world-writable directories; CJS build post-processing integrity (regex replacement vulnerable to Bun bundler drift).
- **MEDIUM (M1–M4)**: Prototype pollution via untrusted JSON; unbounded Map growth in cache structures; unsafe numeric parsing in env vars; leaked `setTimeout` timers.
- **LOW (L1–L4)**: Unsanitized toast output strings; unpinned runtime dependency (`@opencode-ai/plugin`); missing build verification; unsafe `(part as any).reasoning` type cast.
- **INFO (I1–I5)**: No `SECURITY.md`; no single-maintainer acknowledgment; no CI pipeline; missing `npm publish --provenance`; dead/misleading `encodeText()` placeholder.

## Decision Drivers

1. **Defense in depth** — Every config path, config file, env var, toast string, and build artifact should have validation.
2. **Deterministic builds** — CJS post-processing should survive Bun bundler internal renames and be verifiable after every build.
3. **Memory safety** — Cache structures that grow per-session need measured bounds, not unbounded growth.
4. **Type safety** — No `as any` casts; extend the `Part` interface.
5. **Operational security** — Dependencies pinned to exact versions; CI with audit, Trivy, and provenance publishing.

## Considered Options

### Option 1: Patch existing code in-place (rejected)

- **Pros**: Quickest path; no new files.
- **Cons**: Validation logic would be scattered across `config.ts`; no reusable primitives; build changes remain fragile; no CI means no regression protection.
- **Verdict**: Rejected.

### Option 2: Add 4 new utility modules + build hardening + CI (accepted)

- **Pros**: Clean separation between reusable utilities and plugin logic; build integrity can be asserted and checksummed; CI prevents regression.
- **Cons**: Larger change surface (16 new files, 9 modified); requires submodule commit discipline.
- **Verdict**: Accepted.

## Decision

Apply Option 2 with the following architecture:

1. **New utility modules** (with full test coverage):
   - `src/validation.ts` — `sanitizeConfigKeys()`, `validateConfigShape()`, `parseFiniteInt()`, `parseFiniteFloat()`
   - `src/sanitize.ts` — `sanitizeForDisplay()` (ANSI/control-char stripping + truncation)
   - `src/bounded-map.ts` — `BoundedMap<K, V>` with monitor and enforce modes
   - `src/timer-registry.ts` — `TimerRegistry` class with unified `setTimeout` lifecycle
2. **Integrate into plugin core**:
   - `config.ts` uses validation helpers and directory-permission checks.
   - `index.ts` replaces plain `Map<K, Map<string, V>>` with `BoundedMap` in monitor mode; replaces ad-hoc `pendingDisplayTimers` map with `TimerRegistry`.
   - `ui.ts` accepts `TimerRegistry` for `scheduleFlush`; applies `sanitizeForDisplay` to agent labels.
   - `types.ts` adds `reasoning?: string` to `Part`; removes need for `as any` cast.
   - `tokenCounter.ts` removes dead `encodeText()` export.
3. **Build hardening**:
   - `build.ts` rewritten with anchor-based `module.exports` replacement, post-build assertion (`require` and `typeof === "function"`), SHA-256 checksum recording to `dist/.checksums.json`.
   - `scripts/verify-build.sh` checks built artifacts against checksums.
4. **Dependency pinning**:
   - `@opencode-ai/plugin` moved from `dependencies` to `peerDependencies` with range `>=1.0.0`; added to `devDependencies` at exact version `1.14.18`.
   - `typescript` and `@types/node` pinned to exact versions.
5. **CI & security policy**:
   - `.github/workflows/ci.yml` — test + build + checksum verification + typecheck + `no-console` lint gate.
   - `.github/workflows/security.yml` — `npm audit`, Trivy filesystem scan, lockfile integrity check.
   - `.github/workflows/publish.yml` — build + checksum verification + `npm publish --provenance`.
   - `.github/dependabot.yml` — weekly npm and GitHub Actions updates.
   - `SECURITY.md` — supported versions, GitHub Security Advisories reporting, coordinated disclosure timeline.

## Rationale

The security findings were individually minor but collectively damaging to long-term maintainability. The decision to introduce 4 focused utility modules aligned with papai's project conventions (each concern gets its own file + tests). The build hardening was the largest change — replacing a brittle regex replacement with anchor-based line scanning and post-build dynamic require validation — but it directly closes a supply-chain integrity gap that would silently break the CJS export if Bun ever renamed internal variables. CI was previously absent entirely; adding three workflows and Dependabot coverage created a standard open-source security baseline.

## Consequences

### Positive

- All 15 audit findings are closed with targeted, test-covered fixes.
- Config loading is hardened against prototype pollution, world-writable directories, and malformed env vars.
- Cache structures report size warnings and can switch to enforce mode later.
- Timer leaks prevented via unified registry with process-exit cleanup.
- Build integrity is assertable (export count = 1, dynamic require succeeds, checksums match).
- Dependency tree is pinned; compromised minor releases cannot auto-install.
- `npm publish --provenance` provides integrity attestations.
- 89 tests pass in the plugin test suite.

### Negative

- **15% increase in file count** — from ~10 core files to ~26 files (including tests and CI).
- **Build time slightly increases** — checksum generation and CJS validation add ~1-2s per build.
- **Breaking API change**: `encodeText()` removed; any downstream consumer would need to migrate. Mitigation: it was already a no-op.

### Risks

- **Risk**: `BoundedMap` in monitor mode does not evict entries — memory growth is still possible, only warned.
  - **Mitigation**: The design explicitly documents switching to `enforce` mode after observed-peak profiling; warn thresholds act as tripwires.
- **Risk**: `validateConfigShape` allowlist must stay synced with `Config` interface additions.
  - **Mitigation**: Test coverage in `integration.test.ts` and `validation.test.ts` catches unknown-key rejection.

## Implementation Status

Implemented — all changes verified in submodule commit `25193d0361223cd7acfb9287424b1c6c52885f86`.

### Files changed

#### New (16)

| File                                   | Description                            |
| -------------------------------------- | -------------------------------------- |
| `src/validation.ts`                    | Config input validation helpers        |
| `src/sanitize.ts`                      | Display string sanitization            |
| `src/bounded-map.ts`                   | Bounded map with monitor/enforce modes |
| `src/timer-registry.ts`                | Unified timer tracking                 |
| `src/__tests__/validation.test.ts`     |                                        |
| `src/__tests__/sanitize.test.ts`       |                                        |
| `src/__tests__/bounded-map.test.ts`    |                                        |
| `src/__tests__/timer-registry.test.ts` |                                        |
| `src/__tests__/build.test.ts`          | Build output integrity tests           |
| `scripts/verify-build.sh`              | Build verification script              |
| `SECURITY.md`                          | Vulnerability reporting policy         |
| `.github/workflows/ci.yml`             | CI pipeline                            |
| `.github/workflows/security.yml`       | Security scanning pipeline             |
| `.github/workflows/publish.yml`        | Provenance publishing pipeline         |
| `.github/dependabot.yml`               | Dependabot configuration               |
| `dist/.checksums.json`                 | Generated by build                     |

#### Modified (9)

| File                  | Description                                                  |
| --------------------- | ------------------------------------------------------------ |
| `src/config.ts`       | Hardened with validation, sanitization, strict parsing       |
| `src/index.ts`        | Integrated BoundedMap + TimerRegistry; removed unsafe cast   |
| `src/types.ts`        | Added `reasoning?: string` to Part interface                 |
| `src/ui.ts`           | Sanitized agent labels; accepts TimerRegistry                |
| `src/tokenCounter.ts` | Removed dead `encodeText()`                                  |
| `build.ts`            | Anchor-based replacement + validation + checksums            |
| `package.json`        | Pinned deps; moved `@opencode-ai/plugin` to peerDependencies |
| `RELEASE_NOTES.md`    | Noted v0.3.0 breaking change                                 |
| `.npmignore`          | Excluded `scripts/`                                          |

### Test results

- 89 plugin tests passing.
- Build produces verified CJS/ESM with checksums.

## Related Decisions

- [ADR-0096](0096-opencode-tps-meter-removal.md) — Later removed the local TPS meter plugin entirely; the hardening work was preserved in the upstream fork `wKich/opencode-tps-meter`.
- [ADR-0094](0094-single-proxy-tool-deprecated-by-intent-routing.md) — Confirms the project's shift away from OpenCode-specific patterns.

## References

- Archived plan: `docs/archive/2026-04-21-opencode-tps-meter-security-hardening.md`
- Archived design spec: `docs/archive/2026-04-21-opencode-tps-meter-security-hardening-design.md`
- Upstream fork (hardened): `https://github.com/wKich/opencode-tps-meter`
