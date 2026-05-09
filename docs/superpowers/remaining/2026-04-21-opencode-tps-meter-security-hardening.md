# Remaining Work: 2026 04 21 opencode tps meter security hardening

**Status:** not_implemented
**Generated:** 2026-04-29
**Plan:** `docs/superpowers/plans/2026-04-21-opencode-tps-meter-security-hardening.md`

## Completed

_None identified._

## Remaining

- Task 1: Validation Utilities (validation.ts, validation.test.ts)
- Task 2: Sanitization Utilities (sanitize.ts, sanitize.test.ts)
- Task 3: Bounded Map with Profiling Phase (bounded-map.ts, bounded-map.test.ts)
- Task 4: Timer Registry (timer-registry.ts, timer-registry.test.ts)
- Task 5: Integrate Validation into Config Loader (config.ts, integration.test.ts)
- Task 6: Integrate BoundedMap and TimerRegistry into Plugin (index.ts, ui.ts)
- Task 7: Integrate Sanitization into UI (ui.ts)
- Task 8: Remove (part as any).reasoning Cast (types.ts, index.ts)
- Task 9: Build System Hardening (build.ts, build.test.ts)
- Task 10: Remove encodeText() (tokenCounter.ts, RELEASE_NOTES.md)
- Task 11: Dependency Pinning (package.json)
- Task 12: Build Verification Script (verify-build.sh, .npmignore)
- Task 13: CI Workflows (ci.yml, security.yml, publish.yml, dependabot.yml)
- Task 14: Security Policy (SECURITY.md)

## Suggested Next Steps

1. Initialize the plugin directory structure at .opencode/plugins/opencode-tps-meter/
2. Implement utility modules (Tasks 1-4) following the TDD approach outlined in the plan
3. Integrate new utilities into core plugin logic (Tasks 5-8)
4. Harden build, dependencies, and CI/CD pipelines (Tasks 9, 11-14)
