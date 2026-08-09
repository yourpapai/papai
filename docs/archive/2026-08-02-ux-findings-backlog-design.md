<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX findings backlog: status tracking and re-verification

`docs/ux-reviews/` holds 18 section review documents carrying roughly 130 findings. Sub-projects A–K have since fixed a large share of them — but no finding records that it was fixed, so the documents read as if everything is still open. Nobody can answer "what UX work is left?" without re-reading every document against current source.

This project makes that question answerable and keeps the answer true:

1. Every finding gains a stable id and a status.
2. A generated roll-up ranks the open ones, gated by a test so it cannot drift.
3. Every section is re-reviewed in full, which is what actually assigns the statuses.

Step 3 is the substance. Steps 1 and 2 exist so its output survives.

---

## Why re-review rather than spot-check

A finding could be marked resolved by checking whether its specific complaint still reproduces. That is cheaper and it is the wrong instrument. Most of the fixes landed in shared primitives — `Btn`, `Field`, `Input`, the state components — so a section can have had six findings closed by a change that never touched the section's own file. A per-finding check reads the finding's source anchor, finds the line unchanged, and reports "still open" when the defect is long gone.

A full re-review reads the current screenshots and the current source together, which is the only way to see a fix that arrived from underneath. It also re-scores the rubric, so the score reflects the component as it is now rather than as it was in June. The cost is real, and it is the cost of an accurate answer.

---

## The finding record

Each finding gains two fields in its metadata block:

```markdown
### [High] Destructive action has no confirmation

- **Id:** members-delete-no-confirm
- **Status:** open
- **Dimension:** 2. Affordance & signifiers
- **Where visible:** Populated / 1280px
- **Source:** `client/settings/sections/MembersSection.svelte:88`
- **Suggested fix:** Route the delete through the shared confirm dialog.
```

**`Id`** is kebab-case and section-prefixed. It is assigned by hand and **never derived from the heading** — a derived id changes the moment someone rewords a title, silently orphaning every reference to it. Ids are never reused, including for findings that close.

**`Status`** takes exactly three values:

| Value | Meaning | Requires |
| --- | --- | --- |
| `open` | Still reproduces. | — |
| `fixed` | No longer reproduces. | `**Resolved:**` naming the commit or sub-project |
| `superseded` | No longer meaningful — the UI it described is gone or was redesigned. | `**Resolved:**` |

There is deliberately no `partial`. A partially-fixed finding stays `open` and the reviewer **narrows its text to the residue**, keeping the id. This forces the reviewer to say what specifically remains, which is the information a later implementer needs; `partial` would let them defer that and leave the finding as vague as it was.

Severity stays in the `### [Sev]` heading and is re-assignable — a re-review may find that a High is now a Low because the surrounding UI improved, and that is a legitimate outcome to record.

`**Date:**` in the document header changes meaning from "date written" to **last reviewed**. The roll-up surfaces it, so a section nobody has revisited reads as stale rather than as verified.

---

## The generator and its gate

Two files, following the split the repo already uses for `coverage/ratchet-lib.ts` + `coverage/ratchet.ts`:

- **`scripts/ux-backlog-lib.ts`** — pure. `parseFindings(markdown, filename)` and `renderBacklog(records)`. No filesystem, no process exit, fully unit-testable.
- **`scripts/ux-backlog.ts`** — the CLI. Reads `docs/ux-reviews/*.md`, calls the library, writes `docs/ux-reviews/_BACKLOG.md`. Wired as `bun run ux:backlog`.

### The parser fails loud

It never skips a malformed record. Skipping is how a backlog silently under-reports: one typo and a High finding vanishes from the roll-up while the document still contains it. `parseFindings` throws on:

- a `### [Sev]` heading with no `Id`
- a duplicate `Id` anywhere in the corpus
- a `Status` outside the three values
- `fixed` or `superseded` with no `Resolved:` line
- a severity outside High / Med / Low

### Backlog contents

A summary header — per-section open and fixed counts, plus each section's last-reviewed date — then open findings ranked severity-first, each as severity · section · id · title · source anchor. Closed findings are **counted, not listed**: the count is the useful signal, and listing them would make the roll-up grow without bound while burying the open work.

### The gate

`tests/scripts/ux-backlog.test.ts`, not an entry in `check.sh`. It carries the parser's error cases as unit tests plus a **currency assertion**: regenerate the backlog in memory from the current documents and diff it against the checked-in `_BACKLOG.md`. If someone edits a finding's status and forgets to regenerate, the test fails.

### Named trap: the stamper and the generator

`_BACKLOG.md` is both generated and subject to `license:headers`. If the generator emits an SPDX block that differs by even a byte from what `scripts/add-license-headers.ts` produces, the two fight: the stamper rewrites the header, the currency test sees a diff, regenerating reverts the stamper's edit, and the pair flaps forever. The generator must emit the header byte-identically, pinned by a test asserting the stamper is a no-op on generated output.

---

## The re-review workflow

### Backfill first

One pass over all 18 documents giving every existing finding an `Id` and `Status: open`. Ids are derived once here — from the current headings, by hand — and then frozen. Starting everything at `open` is deliberate: `open` is the claim that requires no evidence, and the re-reviews supply the evidence for every status that is not `open`.

### Per section

1. Re-shoot: state stories, interaction states, and the ~640px narrow states.
2. Read the shots and the source together — **including the shared primitives the section consumes**. This is the step that catches fixes that arrived from underneath, and skipping it reproduces exactly the error the spot-check approach makes.
3. Walk every existing finding by id: confirm it still reproduces, or set `fixed` / `superseded` with a `Resolved:` line, or narrow it to its residue.
4. Re-score all nine rubric dimensions.
5. Add any new findings with fresh ids.
6. Update `Date:`, regenerate the backlog, commit.

`.claude/skills/ux-review/SKILL.md` is updated to describe this, so future reviews produce records in the same shape rather than reverting to the old format.

### What re-reviews may edit

The `ux-review` skill is report-only, and that stays true for component code. Re-reviews may edit **`*.stories.svelte` and `tests/visual/**` only** — a section whose story lacks an empty state cannot be reviewed for its empty state, and blocking on that would mean either a fabricated finding or a gap in coverage. No changes to components, CSS, or `src/`.

### Sequencing

Batches of roughly four to five sections, ordered by open-High count so the highest-signal sections are re-verified first.

---

## Decomposition

| Task | Deliverable |
| --- | --- |
| 1 | Backfill ids and statuses across all 18 documents; update `_TEMPLATE.md` |
| 2 | `scripts/ux-backlog-lib.ts` with fail-loud unit tests |
| 3 | `scripts/ux-backlog.ts`, the `ux:backlog` script, the first `_BACKLOG.md`, currency + stamper-idempotence tests |
| 4 | Update `.claude/skills/ux-review/SKILL.md` |
| 5–8 | Four re-review batches |

Task 1 precedes task 2 so the parser is written against real records rather than invented ones. Task 3 precedes the re-reviews so each batch can regenerate as it goes.

---

## Risks

**The visual-audit floor moves.** Each batch that adds a story changes the expected count, so each batch states its own expected number rather than referring to a global constant. The current floor is **458 passed / 0 failed**.

**Baseline hygiene.** Shooting a *newly added* story is baseline creation and is correct. Re-shooting after changing something under test is the tautology that sub-project I exists to prevent. The two are indistinguishable at the command line — both are `bun shoot -g X` — so this belongs in the plan's Global Constraints where every task inherits it, not in any single task.

**Story fixtures.** New stories follow sub-project D's MSW namespacing convention; a fixture that collides with another section's handlers produces a story that renders differently depending on test order.

**`check:full`** stays at its current 10–11 of 12; the two failures are pre-existing repo-level parallel-load flakiness and are not this project's to fix.
