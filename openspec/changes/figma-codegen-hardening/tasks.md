# figma-codegen-hardening — Tasks

## 1. Registry file scoping

- [x] 1.1 TDD: add failing test — `RegistrySchema` requires a non-empty `fileKey`; missing/empty fails validation naming the field (`tests/scripts/figma-connect.test.ts`)
- [x] 1.2 Add `fileKey` (value `o8B8JfxhFeOHqIfpv0eSdZ`, the `papai-admin-settings-UI` file) to `scripts/figma/registry.json` and to `RegistrySchema` in `scripts/figma-connect-lib.ts`; make `checkRegistry` report missing/empty as an error
- [x] 1.3 TDD: `planPayloads` output includes `fileKey` on every payload; `figma:connect plan` prints it
- [x] 1.4 Update `docs/architecture/figma-codegen.md` push section: verify the target file's key matches the payload's before writing

## 2. Canonical push/verify snippets in the skill

- [x] 2.1 Add the canonical push script to `.claude/skills/figma-codegen/SKILL.md` step 7 — batched component-description writes (≤~10 per call), returning mutated node ids, after confirming the target file key matches the payload's `fileKey`
- [x] 2.2 Add the canonical read-back script — compares each component description verbatim against plan output, returns the mismatch count (zero = idempotent)
- [x] 2.3 Adjust step-7 prose to reference the snippets instead of describing the steps abstractly

## 3. Verification

- [ ] 3.1 `bun test tests/scripts/figma-connect.test.ts` green; full suite, typecheck, lint, format pass
- [ ] 3.2 Re-run the push + read-back snippets against the live file once to confirm they reproduce the verified state (6/6, zero mismatches)
