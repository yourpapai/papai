<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## ADDED Requirements

### Requirement: Integrity-substituted gates render the substituted blocker

When the counts-integrity cross-check substitutes an open `POLICY-INTEGRITY` BLOCKER into the ladder's review result, the rendered gate file SHALL carry that blocker as a visible row (blocker section, the failure reason, and the acknowledgment path) — the same guarded result the ladder decides on SHALL feed the operator surface, so a human settling an integrity-substituted gate can see and acknowledge exactly what the rules could not decide.

#### Scenario: Substituted blocker renders for the operator

- **WHEN** a closed round's sidecar is corrupted before the gate that reads it presents and the cross-check substitutes the `POLICY-INTEGRITY` BLOCKER
- **THEN** the rendered gate file carries the blocker row naming the integrity failure, no rule auto-decides, and the operator's explicit settle acknowledges the rendered failure
