<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# What is still open in `ROADMAP.md`, and what it is worth

Every finding that is not marked `[FIXED]`, re-checked against the tree at
`422c915` rather than trusted from its marker — because two markers in this file
have already been wrong, in both directions.

Verdict first:

| Finding                     | Real state after checking          | Fix it?                    | Effort               |
| --------------------------- | ---------------------------------- | -------------------------- | -------------------- |
| Stryker blind spot          | **closed by the widening** (below) | no — done                  | done — see below     |
| `check.sh` gap              | **closed by pin** (below)          | no — done                  | done                 |
| Stale markers               | four wrong, one of them mine       | **yes** — now              | ~20 minutes          |
| **S6-6** coverage floor     | **closed by measurement** (below)  | no — record the number     | done here            |
| **S5-5** job timeout        | premise overtaken twice            | no — reword                | ~5 minutes           |
| **S6-2** delivery fake      | closed by S1-2, marker never moved | no — marker only           | in the above         |
| **S5-10** billable no-ops   | real, and the fix is worse         | **no** — record and accept | n/a                  |
| **S3-8** residuals          | one unfixable, one one-line        | **no** — correctly noted   | n/a                  |
| **S3-2** process isolation  | genuinely open, genuinely big      | **not now** — see below    | weeks, and CI-shaped |

---

## The two worth doing — both since closed by the widening

Both were re-checked genuinely open at `422c915`, and this file ranked them the
two worth doing. The mutation-gate widening has since done both — the
`ROADMAP.md` markers are `[FIXED]` — and the records below are updated to
closed rather than deleted, because the ROADMAP blurb sends readers here for
what the two findings cost and what fixing them cost.

### The Stryker blind spot — closed by the widening

**The finding stood, and its own scope figure was stale.** The workspace this
file measured at ~8.9k lines is 152 product files / 25,205 lines (measured
2026-09-03), so the unmeasured surface was ~3× the recorded size. The ratchet
now sees all of it:

1. `opencode-agent/src/` is a sixth gateable root in `isGateableImplFile` —
   the changed-file gate's sole scoping authority — so `test:mutate:changed`
   and the plan/shard/gate CI dispatch select workspace sources, and a
   workspace-only branch no longer selects zero targets and passes unmeasured.
2. `stryker.config.json`'s `mutate` globs enumerate the tree for all-files
   runs, excluding the `index.ts` barrel like every other gated tree.
3. The resolver mappers learned the workspace's **flat** layout —
   `opencode-agent/src/**/x.ts` ↔ `tests/opencode-agent/x.test.ts` — which is
   where all 70 test files actually sit.

Floors shipped in the same commit as the widening
(`scripts/mutation/baseline.json`), so the scope never existed without them.
The measurement this file demanded before committing to scope happened, and
decided it: a fitted per-file cost model (226 measured runs) priced the
full-scope seed at a one-off ≈4 h of chunkable measurement — 4–8 chunks of
30–60 min, `seedMerge` per-key max and idempotent — against a steady state
bounded by changed files (~96 s per touched workspace file). The hot-file
fallback this file allowed for was declined on those numbers: a one-time few
hours against a permanent hole in the strongest gate. The hand-run mutation
checking that carried the workspace until then — five stages of it, repeatedly
finding real gaps the suite did not pin — is retired with the blind spot.

### The `check.sh` gap — closed by pin, not by proxy entries

**Verified, and the remedy this file proposed is not the one that closed it.**
Four `opencode-agent:*` entries in the full checks array would have
re-introduced the per-workspace proxies that root-checks-only full mode had
already removed. The staged enumerations already routed
`opencode-agent/src/*`; what remained was the risk the effect clause named —
the shell check and the gate silently disagreeing about what product code is.
That is pinned shut from both sides: `tests/scripts/check.test.ts` derives the
gateable roots live from the widened `isGateableImplFile` and the path-prefix
arms live from `check.sh`'s staged license/oxlint enumerations, then asserts
every root is routed by both or recorded as a keyed exception (`plugins/` and
`afk-runner/src/` are the two known gateable-but-unrouted trees). A seventh
gateable root without a matching shell arm fails the pin instead of drifting —
the asymmetry can no longer mislead silently.

---

## The one that is bigger than it looks

### S3-2 remainder — containment is config-level, not process-level

**Genuinely open, and correctly described.** There is no container or network
boundary around the model. What exists is good and does most of the work:
capabilities are deny-by-default per agent profile, `scrubSecrets` strips
credentials from the environment before anything spawns, the provider key never
reaches OpenCode (`provider-proxy.ts`), and the repository token is not in
`.git/config`.

**What is actually at risk if an injected prompt defeats the capability config.**
Worth being precise, because the honest answer is narrower than "no sandbox"
sounds:

- Provider and repository credentials are already out of reach — that is S3-2's
  own closed half plus S3-7 and S3-9.
- The `build` profile can run `bash`, so it has the checkout and the network. On
  a **public** repository the checkout is public, so the exfiltration prize is
  small.
- On a **private** repository it is not small, and that is the case that should
  gate this decision.
- The provider proxy listens on loopback holding the real key. Anything already
  running code on the runner can call it — stated in S3-9 as containment, not
  authentication, which is the right framing but does mean the proxy is a
  credential-shaped target for exactly this threat.

**Effort: weeks, and the shape fights the platform.** Real isolation means either
running the OpenCode server in a container inside an Actions job
(container-in-container, with the checkout bind-mounted and egress filtered) or
moving the whole pipeline to a self-hosted runner with a network policy. Both
are infrastructure projects, not a patch. The SDK spawns and manages the server
process itself, so the boundary has to go around the job rather than around the
call.

**Recommendation: not now, and the trigger for revisiting is explicit.** Do it
when this pipeline is pointed at a private repository whose contents matter, or
when it is given a token with access beyond the repository it runs in. Until
then the capability and credential boundaries are the ones carrying the weight,
and they are closed. The limitation is already stated in the README and in the
blurb, which is the correct treatment for a risk that is accepted rather than
overlooked.

---

## Closed by checking — no work needed beyond the marker

### S6-6 — the coverage floor, measured

The finding says "eight of the spike's files sit below the floor" and "should be
checked before merge". **Checked:** `bun test tests/opencode-agent --coverage`
reports the workspace at **93.6% functions / 95.2% lines** across 59 files —
above the aggregate 90/90 floor in `scripts/coverage/floor.json`, so the
workspace _raises_ the aggregate rather than dragging it. The risk the finding
flagged did not materialise, largely because the work since then arrived with
tests. Record the number and close it.

### S5-5 — the job timeout, overtaken twice

The finding cites `timeout-minutes: 45` at `agent-pipeline.yml:31`. The file now
says **90**, at line 52. More importantly its harm clause — "a job that is merely
slow across several turns still dies **silently**" — is no longer true: stage 4
widened the fallback comment to `cancelled()` and to `workflow_run` events, and a
runner killed by `timeout-minutes` is one of the cases that step's own comment
now names. The job can still die at 90 minutes; it can no longer do so in
silence. Reword to what remains: the ceiling is a guess, and nothing has measured
a real implement-plus-review run against it.

### S6-2 — closed by S1-2, marker never moved

S1-2's `[FIXED]` narrative states it: a `hostileGit()` fake that throws on every
operation drives a full resume, and both new tests were mutation-checked. The S6
list at line 1584 was never updated. Marker only.

---

## Real, and the fix would be worse

### S5-10 — a comment mentioning `/approve` boots a runner that then skips

**Still true.** The workflow deliberately carries no comment-body filter, because
S1-3 established that the clarification loop needs plain replies to reach the
pipeline. So any maintainer comment starts a job; the in-process guardrails then
skip it cheaply.

**Effect: billable, not harmful** — and less bad than when the finding was
written, because such a run now leaves a 👍 or 😕 reaction rather than nothing, so
the boot is at least visible to the person who caused it. Cost is roughly a
runner-minute per non-actionable comment.

**Why not to fix it:** the only workflow-level filters available are the ones
S1-3 removed. Gating on "the issue carries a state block" would need the
workflow to read issue comments in an `if:` expression, which it cannot do.
Reintroducing a slash-command filter would re-break the clarification loop — a
closed S1 traded for a cost measured in pennies. Record it as accepted.

### S3-8 residuals — one unfixable, one not worth a harness

- **`main`'s `process.stderr.write` on an escaped throw is unredacted.** It
  cannot be fixed: a config failure happens _before_ any secret is known, so
  there is no list to redact against. Correctly recorded as unfixable rather than
  as a to-do.
- **The single line in `runCli` that chooses the logger factory** is a review
  surface no test can hold short of capturing stdout through a full run. The
  finding's own framing — "a one-line review surface, not a silent hole" — is the
  right call. Building a stdout-capture harness to cover one line is a poor
  trade.

---

## Doc staleness — do this now, it has already caused two errors

The blurb has now been wrong twice, and the second time I wrote it.

1. **"S4 onwards is untouched"** — false, and I preserved it in `422c915` while
   correcting the sentence beside it. **S4 is entirely `[FIXED]`** (all ten
   items, five of which were closed by unrelated work and never marked). S5 is
   fixed apart from S5-5's reworded remainder and S5-10. This is my error and
   should be corrected in the same place I introduced it.
2. **S6-2** shows as open; S1-2 closed it.
3. **S6-6** shows as an unmeasured risk; it is measured above.
4. **S5-5** cites a line number and a value that are both stale.

**Effect of leaving them:** exactly what happened here — a reader trusts a marker
and reaches a wrong conclusion. That is not hypothetical for this file; it is its
recurring failure mode, and the duplication fixed in `422c915` was the same
disease. The blurb is load-bearing precisely because it is the part people read
instead of the 1,600 lines below it.

**Effort: ~20 minutes**, all in `ROADMAP.md`.

---

## Suggested order

1. **Doc staleness** (~20 min) — cheapest, and it stops the file misleading the
   person who does the rest.
2. **S3-2**, only on the trigger stated above.
