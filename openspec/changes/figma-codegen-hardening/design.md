# figma-codegen-hardening — Design

## Context

See proposal.md — Why. The fallback landed in `figma-codegen-fallback` (registry + `figma:connect` + skill + `figma:verify`); the six component descriptions are already pushed to the `papai-admin-settings-UI` file (`o8B8JfxhFeOHqIfpv0eSdZ`) and verified idempotent. Constraints carried over: repo scripts cannot reach the Figma MCP (push and Figma-side checks stay agent-run — design Decision 2 of the parent change), and the registry is hand-maintained by choice.

## Goals / Non-Goals

**Goals:**
- A duplicated/re-created Figma file can no longer silently capture registry lookups or receive pushes.
- Future agent runs push and verify with the same scripts, producing the same batching and reporting behavior every time.

**Non-Goals:**
- No AST parsing of Svelte sources; dictionaries stay hand-maintained.
- No scripted Figma writes (plugin `describe` op) — the documented upgrade path, unchanged.
- No changes to the canonical `CODE:` description format — payloads keep their shape and only gain a `fileKey` field alongside `figmaNode`/`description`.

## Decisions

1. **`fileKey` is a top-level registry field, not per-entry.** One registry maps one Figma file; per-entry keys would be 24 copies of the same string and a schema complication for zero gain. Alternative rejected: per-entry (or per-collection) `fileKey` — only justified if one registry ever serves multiple files, which the file-per-design-system layout makes unlikely.
2. **Validate checks presence/format; correctness stays agent-run.** `validate` fails on missing/empty `fileKey` but cannot confirm the key resolves to the right file (headless scripts hold no Figma access). The agent-run check lives in the skill: compare the plan payload's `fileKey` against the file being edited before pushing. This mirrors the parent change's headless/agent split rather than fighting it.
3. **Snippets live in SKILL.md, not in a repo script.** They execute inside the Figma MCP context (`use_figma`), which repo scripts cannot reach; the skill is what agents actually load before pushing. Constraints to encode: batch ≤~10 node writes per call, return mutated node ids, keep the read-back comparison a pure diff against plan output (mismatch count, zero = idempotent). Alternative rejected: a `scripts/figma/` JS file agents would have to inline manually — a copy step that would drift from the skill.
4. **Idempotence means byte-identical.** The read-back check compares descriptions verbatim against plan output (not "starts with CODE:"), matching the deterministic-`plan` contract from the parent design.

## Risks / Trade-offs

- **File duplication still possible, now detectable.** If the design file is duplicated, node ids differ in the copy; `validate`'s Figma-side checks remain agent-run, so the safety net is the skill's pre-push file check — behavioral, like all Figma-side enforcement. Accepted: consistent with the parent design's split.
- **Snippet drift.** The snippets are documentation; if the payload shape changes, they must change in the same PR. Mitigated by the delta spec requiring their use and by the existing plan-shape tests.
- **One more required registry field** breaks hand-written registries that omit it — acceptable: the registry has exactly one real consumer (this repo), and `validate` names the fix.
