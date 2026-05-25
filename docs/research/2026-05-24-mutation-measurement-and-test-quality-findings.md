<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation Measurement & Test-Quality — Findings

**Date:** 2026-05-24
**Type:** Investigation / research only — no `src/` or `tests/` changes were made.
**Spec:** `docs/superpowers/specs/2026-05-24-mutation-measurement-test-quality-investigation.md`

## 1. Executive Summary

_(filled last — headline numbers and the one-line root cause)_

## 2. Track A — Measurement Root Cause

### A1. Baseline status breakdown

| Status       | Count | % of total |
| ------------ | ----: | ---------: |
| Ignored      |  8032 |      77.2% |
| CompileError |   704 |       6.8% |
| NoCoverage   |   667 |       6.4% |
| Survived     |   613 |       5.9% |
| Killed       |   392 |       3.8% |
| Timeout      |     2 |       0.0% |
| **Total**    | 10410 |     100.0% |

Valid (scored) mutants = Killed + Survived + NoCoverage + Timeout = 392 + 613 + 667 + 2 = **1 674** (16.1% of total).

Score math: (Killed + Timeout) / valid = (392 + 2) / 1674 = **23.54%**.

77.2% of instrumented mutants are excluded as static before scoring.

### A2. Runner bucketing mechanism (static vs perTest)

### A3. Scoped reproduction (single well-tested file)

### A4. Variable test — concurrency

### A5. Variable test — preload isolation

### A6. True-score probe (ignoreStatic:false, scoped)

## 3. Track B — Test-Infrastructure Quality

### B1. Preload architecture

### B2. mock.module() blast radius

### B3. DI adherence

### B4. Test-quality signals from mutation data

### B5. Interaction with mutation measurement

## 4. Track C — Synthesis & Deferred Options

### C1. Root-cause statement

### C2. Quality assessment

### C3. Options for a future effort (deferred — not executed)

## 5. Appendix — Commands & Raw Outputs
