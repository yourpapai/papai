<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation Coverage: `src/tools/tool-metadata.ts`

## Summary

Raise the Stryker mutation score of `src/tools/tool-metadata.ts` from the measured
**0.2944** (53 killed / 180 total) to **≥ 0.9** by extending the companion test file
`tests/tools/tool-metadata.test.ts`. The work is **test-only**: no production source is
edited. Every new assertion uses exact equality (`toBe` / `toEqual`) so that each
single-character Stryker StringLiteral mutation (`'x'` → `''`) is provably detected.

## Why this file

`tool-metadata.ts` is the single source of truth that maps every tool name to a
`ToolClassification` (`{ domain, operation, risk }`). Downstream layers resolve tool
permissions, analytics classification, and capability gating off these values, so a
mutated domain/operation/risk silently changes security-relevant behavior. The file is
almost pure data (a ~70-entry static table plus two dynamic prefix branches and one
discriminator), which is exactly the shape where low mutation score means "the table is
spot-checked, not pinned" — the highest-value kind of gap to close.

## Non-goals

- Editing anything under `src/`, `client/`, `plugins/`, or `scripts/`.
- Refactoring the `read` / `write` / `destructive` helper constructors or the table layout.
- Touching `scripts/mutation/baseline.json` (owned by the runner).
- Raising coverage of *other* files; this iteration is scoped to one file.
- Adding tests to any file other than `tests/tools/tool-metadata.test.ts`.

## Measured starting point

Command: `bun test:mutate:file src/tools/tool-metadata.ts`
Report: `reports/paired/src__tools__tool-metadata.ts.stryker-report.json`

| Status       | Count |
| ------------ | ----- |
| Killed       | 53    |
| Survived     | 126   |
| NoCoverage   | 1     |
| **Total**    | 180   |
| **Score**    | 0.2944|

All 127 surviving mutants (126 Survived + 1 NoCoverage) were enumerated from the report.
The helper constructor literals (`'read'`/`'write'`/`'delete'`/`'destructive'` at lines
49, 50, 55, 59, 60) and the two inline open-world entries (`fetch_chat_link`, `web_fetch`
at lines 177–178) are **already killed** by existing assertions; they are out of scope.

## Gap analysis

Every surviving mutant falls into one of four behavioral classes. One test is added per
class (see Design). `id` values are the Stryker `mutants[].id` from the report.

| Class | Locus (file:line) | Mutator(s) | What is untested | Surviving mutant ids | Count |
| ----- | ----------------- | ---------- | ---------------- | -------------------- | ----- |
| **A** | `tool-metadata.ts:33` | BlockStatement | `isToolDomain()` discriminator is never invoked by any test, so its body has NoCoverage. | `0` | 1 |
| **B** | `tool-metadata.ts:64–176` | StringLiteral | The per-tool `domain`/`operation` literals passed to the `read`/`write`/`destructive` helpers are only spot-checked (a handful of tools). Each unmapped entry's literal can flip to `''` undetected. | `15,16,17,18,20,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,109,111,112,113,114,115,121,122,123,124,125,126,127,128,129,130,131,132,133,134,135,136,137,138,139,140,141,142,143,144,145,146,147,148,149` | 122 |
| **C** | `tool-metadata.ts:187` | StringLiteral | The dynamic `mcp_` branch returns a fixed classification, but no test pins the exact object — `domain:'mcp'` and `risk:'open-world'` can flip to `''` undetected (`operation:'read'` is already killed). | `168,169` | 2 |
| **D** | `tool-metadata.ts:191` | ConditionalExpression, StringLiteral | No test verifies the fallback that a name matching *no* static entry and *no* dynamic prefix resolves to `undefined`. Consequently `if (toolName.startsWith('plugin_'))` can be weakened to `if (true)` (id 171) or the prefix literal to `''` (id 174, since `startsWith('')` is always true) without a failing assertion. | `171,174` | 2 |

**Totals:** 1 + 122 + 2 + 2 = **127** surviving mutants.

## Design — tests to add

All four tests are added to `tests/tools/tool-metadata.test.ts` and use exact equality
(`toBe` for scalars, `toEqual` for whole classification objects). They map one-to-one onto
the gap classes.

1. **Class A → `isToolDomain` narrows the domain union exactly.**
   Assert `isToolDomain('task')` is `true` and `isToolDomain('nope')` is `false`. Calling the
   function executes its body (kills NoCoverage mutant `0`); the boolean result also pins the
   return value.

2. **Class B → every static `TOOL_METADATA` entry maps to its exact classification.**
   Build a complete `EXPECTED` map of tool name → `{ domain, operation, risk }` for every one
   of the ~70 table entries, then in one test loop assert
   `expect(getToolMetadata(name)).toEqual(EXPECTED[name])` for each. Because every
   domain/operation literal is mutated independently to `''`, exactly one loop iteration
   fails per mutant, killing all 122. (Risk fields originate from the already-killed shared
   helper literals, but asserting them exactly re-pins them harmlessly.)

3. **Class C → `mcp_`-prefixed tools classify exactly as the open-world mcp object.**
   Assert `getToolMetadata('mcp_my-server__do_thing')` `toEqual`
   `{ domain: 'mcp', operation: 'read', risk: 'open-world' }`. Flipping `domain` or `risk` to
   `''` breaks the deep equality (kills `168`, `169`).

4. **Class D → an unrecognized, non-prefixed name resolves to `undefined`.**
   Assert `expect(getToolMetadata('totally_unknown_tool')).toBe(undefined)`. Under mutant
   `171` (`if (true)`) or `174` (`startsWith('')`), the unknown name wrongly matches the
   plugin branch and returns a classification instead of `undefined`, failing the assertion
   (kills `171`, `174`). The chosen name is not a static key and matches neither `mcp_` nor
   `plugin_`, so it is `undefined` in the unmutated code.

## Verification

1. `bun test tests/tools/tool-metadata.test.ts` is green.
2. `bun test:mutate:file src/tools/tool-metadata.ts` re-measured; the new score is recorded
   in `result.json` notes and every re-measured survivor is declared in the residuals (none
   expected — all four classes are fully killable by the tests above; equivalence is verified
   empirically by the re-measure).
3. The runner independently re-measures and set-matches the UNION of declared residual
   `mutantIds` against its own surviving ids; equality is required.

## Accepted residuals

None anticipated: each surviving class is closed by an exact-equality assertion. If the
re-measure surfaces any residual, it is declared in `result.json` with per-loc reasoning and
the exact Stryker ids; otherwise `residuals` is `[]` and the score target (≥ 0.9, in
practice ≥ 1.0) is met outright.
