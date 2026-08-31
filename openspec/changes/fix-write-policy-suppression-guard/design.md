# Design — Restore the inline-suppression write guard

## Context

`enforceWritePolicy` decides, before a Write/Edit/MultiEdit runs, whether the payload *adds* a lint
or type suppression comment. It has two analysis paths:

1. **Diff path** — reconstruct the resulting file (`buildResultingContent`) and block when the
   suppression count rises versus the file on disk. This is what lets a write that *removes* a
   suppression through.
2. **Fallback path** — when the edit cannot be reconstructed (the `oldString` does not match), scan
   the raw payload fragments (`findPayloadLabels`).

Both paths call `countSuppressions` → `extractComments`, which is the broken function. Everything
below is about replacing that one function correctly.

Measured facts driving the decisions:

```
typescript@7.0.2  →  createScanner: undefined,  SyntaxKind: undefined
ts.createScanner(...)  →  TypeError: ts.createScanner is not a function
oxc-parser@0.143.0 parseSync(f, src).comments  →  [{type:'Line', value:' …', start, end}]
```

## Decisions

### D1 — Fail closed, in two places

The bug is not only that the scanner disappeared; it is that its disappearance was **indistinguishable
from "nothing to block"**. `enforceWritePolicy` wraps its whole body in `try { … } catch { return null }`,
and `null` means allow. A guard whose failure mode is "permit" cannot be relied on.

Two changes follow:

- Comment extraction that cannot analyse content must escalate to the lexical scan (D3), never
  return an empty comment list.
- The outer `catch` keeps returning `null` — a hook must never crash the tool call — but it must
  no longer be reachable for the ordinary "content could not be parsed" case, which is now handled
  inside. The catch stays as a last-resort guard for genuinely unexpected faults (unreadable file,
  bad ctx shape), which is what it was meant for.

### D2 — Use `oxc-parser` directly, not the `src/ts-ast/source-parser.ts` seam

CLAUDE.md says every AST scanner goes through that seam. It does not apply here, for two reasons
that both point the same way:

- **The seam is async** by deliberate design ("the seam stays **async** even though the underlying
  parse is synchronous: every caller is async today"). `enforceWritePolicy` is synchronous and is
  called synchronously from `pre-tool-use.mjs`. Making the hook async to satisfy a convention would
  change the hook entry-point contract for no behavioural gain.
- **The seam lives in `src/`.** A `.mjs` hook that imports product code couples write-time
  enforcement to the app tree; hooks must keep working while `src/` is mid-edit and broken — which
  is precisely when a suppression comment is most tempting.

The rule's *intent* — stop using the TypeScript compiler API, use the oxc family Bun's transpiler
uses — is honoured: `oxc-parser` is the seam's own parser, a direct dependency at `0.143.0`, and
the hook already imported its parser directly rather than through a seam.

### D3 — Parse for accuracy, lexical scan for safety

`parseSync().comments` is exact where it works: it correctly ignores a directive inside a string
literal, which is a test the suite already pins. But it is a **parser**, not the lexer the old code
used, and it drops comments from text it cannot parse. Measured:

| fragment | comments | errors |
| --- | --- | --- |
| `// eslint-disable-next-line foo` | 1 | 0 |
| `const s = "// eslint-disable-next-line in-string"` | 0 | 0 |
| `  } else {\n // @ts-expect-error x\n return` | **0** | 1 |
| `/* oxlint-disable */ const a = (` | 1 | 1 |

Row 3 is the danger: mid-block fragments are the common shape on the fallback path, and a plain
`parseSync` swap would reintroduce the exact fail-open this change exists to fix.

So: extract via `parseSync`; **when the parse reports any error, redo the extraction lexically**
over the raw text. The lexical scan is deliberately biased toward blocking — on unparseable text a
false positive costs the author one rephrase, a false negative costs the repo an unnoticed
suppression.

**Consistency rule for the diff path:** the before/after counts must come from the same strategy,
or a clean-parsing "before" compared against a lexically-scanned "after" would show phantom
additions. When either side fails to parse, both sides are scanned lexically.

### D4 — Wire the hook lane into CI as its own leg

`.hooks/tests/**` is invisible to bun's default discovery (dot-directory), so it needs an explicit
path. Add `test:hooks` = `bun test ./.hooks/tests/` and call it from `scripts/check.sh`'s full
mode, which is what CI runs. The lane is 185 tests in ~1.3s.

**Full mode only — narrowed during implementation.** The plan first said "both full and `--staged`
modes". Implementation found staged mode does not classify `.mjs` at all: its `relevant_files`
filter is `*.ts|*.tsx|*.js|*.jsx|*.json|*.md`, and the mode exits early with "No relevant staged
files to check" when nothing else is staged. So staging only hook files is *already* a complete
no-op locally, and wiring the lane in there would mean first rewriting that classification —
a separate concern from restoring a security guard, and one that changes pre-commit semantics for
every `.mjs` in the repo. The spec requirement is about CI, and full mode satisfies it. The `.mjs`
classification gap is left as a known, unrelated hole.

**`test:hooks` survives `--skip-tests`**, unlike `test` and `test:client`. That flag exists to skip
the multi-minute suite; this lane is ~1.3s, and skipping it would disable the one check that
catches hook rot in exactly the fast local loop where a hook is most likely being edited.

**Rejected: moving `.hooks/tests/` under `tests/`.** It would put hook tests into the mutation
gate's and coverage floor's field of view, and `tests/` maps to impl paths by convention
(`resolveImplPath`), which `.hooks/` does not follow. Bigger change, more coupling, same outcome.

## Answers to the standing design questions

- **Capability / tool_prefs gating:** unaffected — no tool surface. This gates Claude's *own* write
  tools at the harness level, not papai's LLM tools.
- **Scope model:** unaffected. Nothing persists.
- **DB / migrations:** none.
- **New dependencies:** none — `oxc-parser` is already a direct dependency at `0.143.0`.
- **New module:** none. One function inside the existing check is replaced.
- **Hook/TDD interactions:** the change edits the hook pipeline itself. None of its files is
  gateable (`.hooks/`, `scripts/`, `package.json`), so the write pipeline stays silent while
  editing it — which is the same hole that let the regression land. The new CI leg is what closes
  it. Test-first order below.

## Test-first order

1. Confirm the 7 tests fail for the diagnosed reason (done — `TypeError` proven, not a stale
   contract).
2. Add a test that pins the D3 gap directly: an unreconstructable edit whose `newString` is a
   mid-block fragment carrying a directive must block. This fails against both the current code
   *and* a naive `parseSync` swap, so it is the test that makes the fallback correct rather than
   accidentally-passing.
3. Add a test pinning D1: extraction failure must not read as "allow".
4. Replace `extractComments`; watch all 9 go green.
5. Wire `test:hooks` into `package.json` + `scripts/check.sh`.

## Risks

- **False positives on unparseable content.** A write containing the literal text
  `eslint-disable` inside a string, in a file that does not parse, now blocks. Accepted per D3;
  the author rephrases or fixes the syntax error. The parsing path — the overwhelming majority —
  keeps the existing string-literal accuracy.
- **A new CI leg can fail on unrelated hook rot.** That is the point; the lane is currently red and
  this change makes it green first.
