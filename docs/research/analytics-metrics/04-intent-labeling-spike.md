<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Intent-labeling spike

**Experiment date:** 2026-07-23  
**Decision:** advance deterministic `hybrid_v1` for governed validation; keep
`small_model_v1` off  
**Qualification:** synthetic benchmark passed; production qualification is
pending independent human adjudication and a separate opt-in validation set

Intent labels describe the user's goal, not which tool happened to run. The
label is a C2 derived behavioral fact under
[`03-privacy-consent-threat-model.md`](./03-privacy-consent-threat-model.md);
an ineligible or guest turn receives no durable intent.

## Binding taxonomy

`intent.v1` is immutable. A rename, merge, split, or semantic change creates
`intent.v2`; dashboards never reinterpret stored v1 labels.

| ID | Label | Goal boundary |
|---|---|---|
| I01 | `task.create` | Create one or more task-provider work items |
| I02 | `task.find_list` | Search, filter, count, or list tasks |
| I03 | `task.read_detail` | Read the state or details of a known task |
| I04 | `task.update_fields` | Edit task fields without changing workflow state |
| I05 | `task.change_state` | Move/close/reopen or otherwise change task workflow state |
| I06 | `task.collaborate` | Comment, relate, assign, or record collaborative task activity |
| I07 | `task.delete` | Delete a task-provider work item |
| I08 | `project_schema.manage` | Manage projects, labels, statuses, columns, or schema-like resources |
| I09 | `recurring.manage` | Create, inspect, update, or remove recurring work |
| I10 | `deferred.manage` | Create, inspect, update, or cancel a deferred prompt |
| I11 | `memory_memo.write` | Create, archive, or otherwise mutate memory/memos |
| I12 | `memory_memo.find` | Search or read memory/memos |
| I13 | `attachment.manage` | Ingest, search, upload, resolve, or delete attachments |
| I14 | `web.retrieve` | Retrieve public web content |
| I15 | `identity_participant.manage` | Resolve participants or manage identity mappings |
| I16 | `coding.start_review` | Discover a project, start coding work, or initiate review |
| I17 | `coding.monitor_control` | Inspect, steer, stop, or otherwise control an active coding session |
| I18 | `coding.continue_publish` | Continue coding work, publish changes, or complete its forge flow |
| I19 | `configuration_permissions` | Configure a context, provider, feature, or permission |
| I20 | `help_context` | Ask for help, context, capabilities, or operational explanation |
| I21 | `no_action` | Social acknowledgement or deliberate non-goal |
| I22 | `unknown` | Insufficient or conflicting controlled evidence; explicit abstention |
| I23 | `multi_goal` | Two or three distinct I01–I20 component goals |

A `multi_goal` result stores a deduplicated, taxonomy-ordered `goals` array of
two or three component labels. `no_action`, `unknown`, and `multi_goal` are
never component goals. More than three goals fails closed to `unknown`.

## Candidate strategies

| Strategy | Input | Decision rule | Content/egress |
|---|---|---|---|
| A `tool_trace_v1` | controlled semantic tool trace | map only unambiguous registered tool evidence; ignore meta-tools; abstain on unknown/conflicting goal tools | no text |
| B `metadata_v1` | controlled command, feature, and terminal metadata | map explicit structured signals; otherwise abstain | no text |
| A+B `hybrid_v1` | A, then B | accept decisive A; use B only after A abstains | no text |
| C `small_model_v1` | transient message text plus strict taxonomy | asynchronous fallback after every eligibility/processor gate | text leaves process only if separately approved |

A structured tool failure can still identify the attempted goal; it does not
make the outcome successful. Tool-trace rules therefore classify intent and
Outcome v1 independently.

## Synthetic experiment

The committed corpus contains 3,000 visibly synthetic examples across 300
scenario families:

| Cohort | Examples |
|---|---:|
| I01–I20 canonical core, 100 each | 2,000 |
| `no_action` | 250 |
| `unknown` | 250 |
| `multi_goal` | 300 |
| adversarial/near-neighbor, 10 per core label | 200 |

Whole ten-paraphrase families—not individual rows—are assigned to 1,800
development, 600 calibration, and 600 sealed-test examples. The full corpus
contains 1,350 English, 1,350 Russian, and 300 mixed/emoji/command-like rows.
No production message or model-generated example is present.

The ordered corpus SHA-256 is:

```text
6e165b66359bd855306ceed04654b1f7ffb43185ce164d2b7a1db1e1c72724c3
```

The family split prevents paraphrase siblings crossing partitions. It does
not prove external validity: tool names and structured signals are deliberately
generated from the frozen rule vocabulary. The benchmark tests rule closure,
conflicts, abstention, privacy, and evaluation plumbing; it cannot estimate the
distribution of real user goals.

## Sealed-test result

All primary accuracy and macro-F1 values include abstentions as `unknown`.
Coverage is the fraction of examples not marked `abstained`.

| Strategy | Accuracy | Macro F1 | Coverage | Selective accuracy | `no_action` precision | `unknown` precision | ECE |
|---|---:|---:|---:|---:|---:|---:|---:|
| A | 0.850000 | 0.901144 | 0.766667 | 1.000000 | 0.000000 | 0.357143 | 0.074333 |
| B | 0.291667 | 0.179906 | 0.291667 | 1.000000 | 1.000000 | 0.105263 | 0.353417 |
| A+B | **0.991667** | **0.995641** | **0.991667** | **1.000000** | **1.000000** | **0.909091** | **0.010417** |

For A+B, every I01–I20 label has F1 1.0; multi-goal exact-set accuracy,
micro-F1, and macro-F1 are 1.0; Brier score is 0.010501; accepted tool-rule
precision is 1.0. It passed the frozen synthetic thresholds:

- macro F1 at least 0.85 and every core-label F1 at least 0.75;
- `no_action` and `unknown` precision at least 0.90;
- multi-goal micro-F1 at least 0.80 and exact-set accuracy at least 0.70;
- selective accuracy at least 0.90 with coverage at least 0.80;
- ECE at most 0.05 and accepted tool-rule precision at least 0.97;
- label-ready p95 at most 5 seconds, reply-path latency exactly zero, and
  persisted classifier content exactly zero.

The local deterministic worker measured p50/p95 of
0.000125/0.000250 milliseconds on this run. That only shows the rule mapper is
negligible in this Bun microbenchmark; it is not a production latency SLO or a
remote-model comparison.

## SMALL_MODEL result

C is **NOT EXECUTED / NOT QUALIFIED**. No processor, endpoint, credential, or
model was approved, so calls are zero and token, cost, and remote-latency
fields are `null`. No estimate is substituted for evidence.

The PoC runner exists only to freeze the safety contract. It requires all of:

1. explicit process-level classifier approval;
2. an eligible admin/member request;
3. an operator-approved endpoint, model, and credential;
4. strict request/result schemas with no additional properties.

It refuses redirects, holds text in memory only, and emits either a controlled
taxonomy result or a fixed error code. It is never awaited by the user reply
path. These mechanics do not themselves approve a processor or lawful basis.

## Recommendation and rollout gate

Implement A+B behind the governed longitudinal mode, but call it an
**implementation candidate**, not an accurate production classifier. Emit
`unknown` when controlled evidence is absent. Do not add C to the first
implementation.

Before a production accuracy claim:

1. two independent reviewers label all family prototypes plus a stratified
   20% of paraphrases;
2. disagreements are adjudicated and Cohen's kappa for primary labels plus
   Jaccard agreement for component goals are reported;
3. frozen rules run once on a separately governed, opt-in validation set,
   without tuning on that set;
4. every language/context slice and the `no_action`/`unknown` boundary retains
   the frozen thresholds;
5. logs, caches, SQLite, delivery capture, and screenshots repeat the
   zero-content persistence audit.

Until those gates pass, dashboards show strategy, coverage, abstention, and
synthetic-only qualification rather than presenting the label as ground truth.

## Reproducible artifacts

The generator, corpus, strict schemas, evaluator, results, tests, and
SMALL_MODEL status are under [`poc/intent/`](./poc/intent/). The primary
handoff is [`poc/intent/README.md`](./poc/intent/README.md); machine-readable
measurements are
[`evaluation-results.json`](./poc/intent/evaluation-results.json),
[`corpus-manifest.json`](./poc/intent/corpus-manifest.json), and
[`small-model-status.json`](./poc/intent/small-model-status.json).
