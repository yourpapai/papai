# afk-runner live lane

Logs the afk-runner graph itself authored in live proof runs — real `opencode`
spawns, real gates answered through the documented surfaces, induced incidents
(kill -9 mid-review-round, extend-at-final cycle). Marking vocabulary:

| lane            | mark      | provenance                                                     |
| --------------- | --------- | -------------------------------------------------------------- |
| `../real/`      | legacy    | historical sdd-runner runs (ported with their persisted memos) |
| `../scenarios/` | synthetic | extracted/synthetic shapes, `-synthetic` filename suffix       |
| `live/`         | **live**  | authored by the afk-runner engine itself, end to end           |

## mutation-floor-hardening-live

The v1-live-proof M run (2026-08-29, free-tier `zai-coding-plan/glm-5.3`,
$0.00 spend, 20 spawns): intake misclassification drill (prescreen M floor),
draft, four review rounds (round 1 killed mid-flight at seq 195/196 and
resumed same-round via session-ledger continuation — attempt 2 reused the same
opencode session), converged tail, final gate v1 extended (`→ RUN 1 MORE`),
round 4 at raised cap, final gate v2 approved. Terminal memo `completed`.

Oracle: `inventory.test.ts` — folding the log reproduces the persisted memo
fields, and every line validates against the event schemas.

## event-driven-suggestion-payloads-live

The v2-live-proof (C8) Run A (2026-09-01, `zai-coding-plan/glm-5.3` after the
priced synthetic endpoint's outage forced the pre-registered free-tier fallback,
cost-unknown, metered ceiling 0.5 configured, 793 events): M proof run carrying
the holder-kill drill — holder pid + its process group killed mid-round-1 with
the reviewer in flight, orphan observed (ppid 1, own pgid), `resume` appending
exactly one classified `resume{session-continuation}` (seq 296) with the
ledger's in-flight session and **no second `round_open`** (the log-fidelity
pair live), the retry ledger continuing the same opencode session. Final gate
v1: zero-signal probe rejected with directive guidance, steer foreign-id probe
crashed the waiter (F-C1 — the steer settle path escapes throws), `VETO:`
directive settled; the revision carried `EVENT_PAYLOAD_CAP = 3` as a named
decision across artifacts; v2 approved. The metered cost-unknown R4 branch
recorded at both final presentations. Terminal memo `completed`.

## killed-turn-usage-undercount-live

The v2-live-proof (C8) Run B pass 4 (2026-09-02, `zai-coding-plan/glm-5.3`,
unmetered `budget: null`, `deadline: 10` armed, 424 events): the
`POLICY-INTEGRITY` drill — `resolutions-1.json` corrupted to unparseable one
second after round 1's `round_close`; the final gate presented with the
ladder's `auto_decision{rule: none}` (no rule auto-decided — passes 1–3 of the
same matrix slot had each R1-approved in milliseconds) and was settled by an
explicit human `APPROVE`. The deadline stayed armed-never-claimed (F-C3: the
production waiter wiring omits the expiry ports). Terminal memo `completed`.
The matrix slot's bought-verification-round evidence (round 3 needs-review at
cap → `round_open(4, cap 4)`) lives in pass 1's workdir-resident log, cited
from the change notes and the corpus report.
