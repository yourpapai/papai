# figma-codegen-hardening — Proposal

## Why

The post-implementation review of `figma-codegen-fallback` (after the Code Connect comparison) identified exactly two gaps with a real benefit-to-effort ratio, both cheap because the design is otherwise sound. First, `scripts/figma/registry.json` maps Figma **node ids**, which are file-scoped, but never names the Figma file — a duplicated or re-created file breaks every lookup silently, and an agent editing the wrong file can push descriptions into it. Second, the `use_figma` scripts for the description push and its idempotence check exist only in a one-off session transcript; every future agent run reinvents them, inviting inconsistent pushes.

## What Changes

- Registry declares its Figma file: a required top-level `fileKey` field, enforced by `figma:connect validate` (presence/format), carried in every `plan` payload so agents verify they are editing the mapped file before pushing.
- The `figma-codegen` skill ships the canonical `use_figma` snippets for (a) pushing component descriptions from plan output and (b) the read-back idempotence check, replacing ad-hoc agent-written JavaScript.

Deliberately excluded (review verdict: defer/skip): Svelte AST prop-dict generation (trigger: component growth), a plugin `describe` op for scripted pushes (trigger: push frequency), a one-command verify wrapper (partially impossible — Figma export is MCP-side), Dev Mode snippet rendering (Code Connect plan-gated).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `figma-codegen-registry`: adds a file-scoping requirement — the registry names its Figma file, validation enforces it, plan output surfaces it.
- `figma-codegen-skill`: adds a codification requirement — push and idempotence-verification steps are canonical snippets in the skill, not improvised per run.

## Impact

- `scripts/figma/registry.json` — new required `fileKey` (the `papai-admin-settings-UI` file).
- `scripts/figma-connect-lib.ts` — `RegistrySchema` gains `fileKey`; `planPayloads` output includes it.
- `scripts/figma-connect.ts` — `validate` errors on missing/empty `fileKey`; `plan` payloads carry it.
- `tests/scripts/figma-connect.test.ts` — schema/validation/plan coverage.
- `.claude/skills/figma-codegen/SKILL.md` — canonical snippets (step 7 workflow).
- `docs/architecture/figma-codegen.md` — push flow mentions the file check.
- No runtime code, no dependencies, no API changes.
