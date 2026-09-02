<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev. Use of this software is governed by the Business Source License 1.1. See LICENSE in the project root for details. -->

## REMOVED Requirements

### Requirement: Early-gate approval continues the pipeline
- **Reason**: The capability retires with the deleted workspace; the behavior is re-specified by the afk stack, which implements the same outcome-keyed continuation on the graph.
- **Migration**: The `afk-runner-gate` spec ("Outcome-keyed continuation") carries approve-early's `stage_enter(decompose)` continuation; the process canon (`docs/architecture/sdd-pipeline.md`, canonical process sections) keeps the protocol description.

### Requirement: Severity-based convergence
- **Reason**: The capability retires with the deleted workspace; afk-runner implements the same convergence predicate in its review loop.
- **Migration**: The convergence rule (0 BLOCKER, 0 MATERIAL, ≤3 NITPICK over post-resolution findings, nitpick-only cap-hit converged) stays canonical in `docs/architecture/sdd-pipeline.md` and implemented by `afk-runner`'s review stage; the `afk-runner-think-half` spec governs the loop that produces it.

### Requirement: Resume covers post-review stages
- **Reason**: The capability retires with the deleted workspace; afk-runner's resume-by-replay covers post-review stages with strictly stronger guarantees (crash-window healing, prefix property).
- **Migration**: The `afk-runner-think-half` ("Resume by replay") and `afk-runner-tail` ("Mid-stage crash resume in the tail", "Tail crash-window recovery") specs carry the behavior.

### Requirement: Gate decisions disclose their downstream effects
- **Reason**: The capability retires with the deleted workspace; afk-runner's gate rendering discloses the same effects in its gate files.
- **Migration**: The `afk-runner-gate` ("Gate awaiting is machine state", "Settlement through one validated seam") and `afk-runner-gate-settle-robustness` ("Expressible decisions at every gate shape") specs govern what a presented gate discloses and how answers bind to outcomes.
