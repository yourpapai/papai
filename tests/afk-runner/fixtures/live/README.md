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
