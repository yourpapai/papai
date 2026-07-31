<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Intent v1 classification research spike

**Experiment date:** 2026-07-23  
**Decision:** advance deterministic `tool_trace_v1` + `metadata_v1` as the
content-free research candidate; keep `small_model_v1` off.  
**Qualification:** the deterministic candidate passes the numeric thresholds
on the sealed synthetic split, but is not production-qualified until the
scenario prototypes receive independent human review and a later governed,
opt-in validation set confirms external validity.

This directory is an isolated research PoC. It does not alter runtime code,
send production data, or enable analytics collection.

## Corpus and reproducibility

[`intent-v1-corpus.jsonl`](intent-v1-corpus.jsonl) contains exactly 3,000
obviously invented examples generated from versioned, hand-authored English,
Russian, and short mixed-language templates:

| Cohort                                                      | Examples |
| ----------------------------------------------------------- | -------: |
| 100 canonical examples for each core label I01–I20          |    2,000 |
| `no_action`                                                 |      250 |
| `unknown`                                                   |      250 |
| `multi_goal`                                                |      300 |
| Adversarial/near-neighbor boundary cases, 10 per core label |      200 |

The 300 scenario families contain ten paraphrases each. Whole families, never
individual paraphrases, are assigned to development/calibration/sealed-test
splits:

| Dimension            | Counts                                                     |
| -------------------- | ---------------------------------------------------------- |
| Split                | development 1,800; calibration 600; sealed test 600        |
| Language             | English 1,350; Russian 1,350; mixed/emoji/command-like 300 |
| Sealed-test language | English 270; Russian 280; mixed 50                         |

The ordered corpus SHA-256 is
`6e165b66359bd855306ceed04654b1f7ffb43185ce164d2b7a1db1e1c72724c3`.
[`corpus-manifest.json`](corpus-manifest.json) records that hash, all family
assignments, the family-manifest hash, and hashes of the taxonomy, generator,
classifiers, evaluator, prompt, and schemas. Rebuild and verify it with:

```bash
bun docs/research/analytics-metrics/poc/intent/corpus-generator.ts
bun docs/research/analytics-metrics/poc/intent/evaluate.ts
bun test docs/research/analytics-metrics/poc/intent
```

No LLM generated the corpus. Independent human review was not available in
this execution. Cohen's kappa and reviewer Jaccard agreement are therefore
recorded as `null`, not fabricated. That is a production-qualification gate,
not a silent assumption.

## Strategies

- **A — `tool_trace_v1`:** maps only registered, one-to-one semantic tool
  evidence. Meta tools and unmapped dynamic tools abstain. Structured tool
  failures still preserve the user's goal.
- **B — `metadata_v1`:** uses only controlled command families, feature/
  provider signals, and explicit unsupported-goal outcomes. It never reads
  `message`.
- **A+B — `hybrid_v1`:** accepts A first, then B. It never calls a text model.
- **C — `small_model_v1`:** strict, asynchronous, opt-in fallback contract.
  It was not executed because no approved processor endpoint, credential, or
  model was configured.

The benchmark deliberately leaves one social acknowledgement per
`no_action` family without a decisive structured signal. In the sealed test,
five such turns abstain to `unknown`; this exposes the deterministic
content-free boundary instead of hiding it.

## Sealed-test results

The following measurements come from the committed 600-example sealed split.
All accuracy/F1 values include abstentions as `unknown`; coverage is
non-abstained examples divided by all examples.

| Strategy     | Primary accuracy |     Macro F1 |     Coverage | Selective accuracy | `no_action` precision | `unknown` precision |          ECE |
| ------------ | ---------------: | -----------: | -----------: | -----------------: | --------------------: | ------------------: | -----------: |
| Tool trace A |         0.850000 |     0.901144 |     0.766667 |           1.000000 |              0.000000 |            0.357143 |     0.074333 |
| Metadata B   |         0.291667 |     0.179906 |     0.291667 |           1.000000 |              1.000000 |            0.105263 |     0.353417 |
| Hybrid A+B   |     **0.991667** | **0.995641** | **0.991667** |       **1.000000** |          **1.000000** |        **0.909091** | **0.010417** |

For hybrid A+B:

- every core I01–I20 label has F1 `1.000000`;
- multi-goal exact-set accuracy, micro F1, and macro F1 are all `1.000000`;
- Brier score is `0.010501`;
- accepted tool-rule precision is `1.000000`;
- tool-evidence conflict rate and text-egress share are `0`;
- the measured local worker p50/p95 are `0.000125`/`0.000250` ms per
  classification, label-ready p95 is `0.000250` ms, and user-visible added
  latency is exactly `0` because classification is not awaited by a reply
  path;
- persisted classifier input/output content count is `0`.

These sub-millisecond timings characterize only this deterministic Bun
benchmark on the execution host. They are not a remote-provider latency claim.
Exact per-label, language, context, risk-coverage, latency, calibration, and
threshold records are in
[`evaluation-results.json`](evaluation-results.json).

Hybrid A+B passed every binding synthetic threshold:

| Gate                           |               Result |          Threshold |
| ------------------------------ | -------------------: | -----------------: |
| Primary macro F1               |             0.995641 |            >= 0.85 |
| Minimum core-label F1          |             1.000000 |            >= 0.75 |
| `no_action` precision          |             1.000000 |            >= 0.90 |
| `unknown` precision            |             0.909091 |            >= 0.90 |
| Multi-goal micro F1            |             1.000000 |            >= 0.80 |
| Multi-goal exact-set accuracy  |             1.000000 |            >= 0.70 |
| Selective accuracy at coverage | 1.000000 at 0.991667 | >= 0.90 at >= 0.80 |
| ECE                            |             0.010417 |            <= 0.05 |
| Accepted tool-rule precision   |             1.000000 |            >= 0.97 |
| Label-ready p95                |          0.000250 ms |        <= 5,000 ms |
| User-visible added latency     |                 0 ms |                = 0 |
| Persisted classifier content   |                    0 |                = 0 |

## SMALL_MODEL contract and status

The model experiment is explicitly **NOT EXECUTED / NOT QUALIFIED**. Token
counts, cost, provider latency, and label-ready latency are `null`; no values
were estimated or fabricated. See
[`small-model-status.json`](small-model-status.json).

The opt-in runner has four fail-closed gates:

1. `PAPAI_ANALYTICS_CLASSIFIER_APPROVED=true`;
2. request `eligible=true` and an admin/member actor role;
3. an operator-approved endpoint, model, and credential;
4. strict request and result validation with no extra properties.

The runner reads one strict request from stdin, holds message/provider output
in memory only, refuses redirects, never logs raw input/output/errors, and
writes only a controlled result or fixed error code. Its contract artifacts
are:

- [`small-model-prompt.txt`](small-model-prompt.txt);
- [`small-model-request.schema.json`](small-model-request.schema.json);
- [`small-model-result.schema.json`](small-model-result.schema.json);
- [`small-model-contract.ts`](small-model-contract.ts);
- [`small-model-runner.ts`](small-model-runner.ts).

An endpoint/key alone is not approval. Before any execution, the operator
still needs the processor/no-training/shortest-retention review required by
the research method. The runner is asynchronous research plumbing, never a
reply-path dependency.

## Recommendation

Use `hybrid_v1` without C as the implementation candidate: accept decisive
tool evidence, fall back to controlled metadata, and emit `unknown` rather
than inspect text when neither is decisive. Keep SMALL_MODEL disabled.

This is an **advance-to-validation** decision, not a claim that synthetic
template performance transfers to real users. Before production:

1. two independent reviewers must label all family prototypes and a
   stratified 20% of paraphrases, with disagreements adjudicated and
   kappa/Jaccard reported;
2. frozen rules must be tested on a separately governed, opt-in validation
   set without tuning on the sealed synthetic split;
3. language/context slices and the `no_action`/`unknown` boundary must retain
   the same hard thresholds;
4. the zero-content persistence audit must be repeated against actual
   worker logs, caches, database writes, and captured egress.
