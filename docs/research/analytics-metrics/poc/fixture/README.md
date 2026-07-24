<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Synthetic canonical analytics fixture and SQLite models

This PoC creates a disposable, content-free SQLite source for the analytics
provider evaluation. It reads no runtime database, conversation, operator
configuration, or environment secret. The caller selects the output path, and
the generated database stays outside the repository.

## Deterministic evidence

The seed `papai-analytics-fixture-v1` produces:

- 17,183 unique canonical events across 50 UTC dates and 200 pseudonymous
  synthetic actors;
- every platform and the `dm`, `group`, and aggregate-only `none` context
  values;
- `kaneo`, `youtrack`, `other`, and unconfigured task-provider snapshots;
- every canonical actor-role and invocation-mode value, including bounded
  system `proactive` and `scheduler` health facts;
- an ordered activation funnel of 200 → 180 → 160 → 140 → 120 actors;
- exact retained-actor fixtures of D1 = 90, D7 = 60, and D30 = 30;
- all 23 immutable `intent.v1` labels, including `no_action`, `unknown`, and
  `multi_goal`;
- immediate success, same-turn recovery, and mature abandonment examples
  derived from canonical tool outcomes;
- feature availability and successful adoption facts for recurring, deferred,
  memory, attachment, coding, MCP, BYOK, guest mode, web fetch, and live status;
- paired `llm_started` terminal facts, provider/tool/MCP failure facts, TTFT on
  `llm_completed`, first-visible-feedback facts, and live-status lifecycle
  facts;
- all seven Friction Signature v1 components (`R,C,P,S,L,D,F`) and their
  explicit opportunities;
- 325 deliberate duplicate insert attempts, all ignored by the `event_id`
  primary key; and
- 1,224 adjacent source-order regressions, or 7.1233% of rows.

The activation milestones are derived. In particular, there is no
`first_tool_success` event. Step one is the first authorized normal DM
`chat_message_accepted`; step five is the first task-provider mutating
`tool_completed.execution_outcome=semantic_success` after assignment and
within 14 days of step one.

Guests appear only as 200 daily `guest_turn_aggregate` rows (50 dates × four
platforms). Those rows have no actor, context, thread, task-instance, turn, or
session key and use the C0 aggregate collection lane.

## Generate and verify

Run from the repository root. The generator refuses to overwrite an existing
path. Omitting `--output` selects
`/private/tmp/papai-analytics-synthetic.sqlite`.

```bash
export PAPAI_ANALYTICS_FIXTURE=/private/tmp/papai-analytics-synthetic-20260723.sqlite

bun docs/research/analytics-metrics/poc/fixture/generate-fixture.ts \
  --output "$PAPAI_ANALYTICS_FIXTURE"

bun docs/research/analytics-metrics/poc/fixture/self-check.ts \
  --database "$PAPAI_ANALYTICS_FIXTURE" \
  --expected docs/research/analytics-metrics/poc/fixture/expected-summary.json
```

Expected generator evidence:

```json
{
  "seed": "papai-analytics-fixture-v1",
  "eventCount": 17183,
  "actorCount": 200,
  "activeDateCount": 50,
  "duplicateAttempts": 325,
  "duplicateRowsIgnored": 325,
  "outOfOrderRows": 1224,
  "outOfOrderRatio": 0.07123319560030263
}
```

The generator also prints the selected path and the first/last occurrence
timestamps. A successful self-check prints `{"status":"ok"}` with that path.

Execute every reviewed model directly with SQLite:

```bash
for model in docs/research/analytics-metrics/poc/metabase/sql/*.sql; do
  sqlite3 -readonly "$PAPAI_ANALYTICS_FIXTURE" < "$model" >/dev/null
done
```

Run the generator contract, negative privacy checks, and SQL model contracts:

```bash
bun test \
  docs/research/analytics-metrics/poc/fixture/generate-fixture.test.ts \
  docs/research/analytics-metrics/poc/fixture/sql-models.test.ts
```

Delete only the disposable database path you selected after capturing the PoC
evidence.

## Canonical storage shape

`analytics_events` flattens the strict `AnalyticsEventV1` envelope into indexed
columns:

| Group               | Columns                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| identity/version    | `event_id`, `schema_name`, `schema_version`, `event_version`                                                   |
| event provenance    | `occurred_at_ms`, `ingested_at_ms`, `event_name`, `event_source`, `attribution_quality`                        |
| app/deployment      | `app_version`, `deployment_key`, `key_version`                                                                 |
| scoped identity     | `platform`, `platform_instance_key`, `actor_key`, `context_key`, `thread_key`, `task_instance_key`             |
| occurrence snapshot | `context_type`, `actor_role`, `task_provider`, `invocation_mode`                                               |
| correlation         | `turn_key`, `session_key`                                                                                      |
| governance/privacy  | `governance_purpose`, `collection_tier`, `policy_version`, `eligibility`, `privacy_max_class`, `expires_at_ms` |
| strict payload      | `props_json`                                                                                                   |

`props_json` is constrained by a per-event allowlist; it is not generic
metadata. Synthetic pseudonyms use an obvious `syn_` prefix. Event IDs are
SHA-256 values over deterministic canonical fixture inputs.

Before creating SQLite, the generator rejects unknown events, unknown or
missing properties, nested values, content-bearing keys, and URL-, path-,
authorization-, token-, or secret-shaped strings. `self-check.ts` repeats the
same property validation against stored rows and verifies envelope, guest,
TTFT, funnel, retention, duplicate, and source-order invariants.

Insertion `rowid` preserves source-arrival order. Queries must order or window
by `occurred_at_ms,event_id`, never by insertion order.

## Reviewed SQLite models

The four native queries under `../metabase/sql/` expose bounded derived columns
instead of handing dashboard authors unrestricted property JSON:

1. `01-activation.sql` — one row per new-DM actor with authorized-DM,
   seven-day configuration, and 14-day mutating semantic-success rules.
2. `02-retention-engagement.sql` — DAU/WAU/MAU, sessions, turns, exact-calendar
   D1/D7/D30 cohorts, and explicit observable denominators.
3. `03-intents-features.sql` — canonical intent attempts, semantic terminal
   outcomes, tool outcomes, and feature use annotated with activation and
   retention dimensions.
4. `04-reliability-friction-performance.sql` — LLM/provider/tool/MCP error
   numerators and denominators, p50/p75/p90/p95/p99 performance facts,
   visible-feedback/live-status coverage, and Friction Signature v1.

Friction Signature v1 is transparent: `count=R+C+P+S+L+D+F`, range 0–7,
with optional UI value `round(100×count/7)`. There are no hidden weights. The
model returns every component and opportunity beside the count. It is a
review-sampling aid, not a user-sentiment measure, SLO, employee/model ranking,
or direct cross-platform score.

For Metabase, save these as native-SQL models and grant product users access to
the saved models rather than to raw `props_json`. Mount a transactionally
copied snapshot read-only; this fixture does not justify attaching Metabase to
papai's live SQLite writer.

## Interpretation boundaries

- These synthetic rates prove query semantics and provider usability, not real
  papai usage or causal effects.
- Exact-day retention is intentionally distinct from “returned by D30.”
- Feature adoption uses `feature_opportunity.available=true` as its eligible
  population; all-active-actor penetration is not a substitute.
- No-token/tool-only turns are not applicable to TTFT.
- A platform without live-status capability is not recorded as a latency zero
  or lifecycle failure.
- Production pseudonymous analytics still require the catalog's consent,
  purpose-separated HMAC, retention, deletion, and threat-model controls.
