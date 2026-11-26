<!-- SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details. -->

## ADDED Requirements

### Requirement: Gate attendance attribution

For every presented, answered gate the analysis SHALL attribute the answering settle to its origin — human, presentation-time policy, or deadline waiter — computed by the emission-order join already used for extend origins (a settle-kind `auto_decision` emitted before the `gate answered` event attributes policy; after it, waiter; no auto-decision record attributes human) — and SHALL join that origin with the gate's presented-to-answered wait latency. The corpus aggregate SHALL report the human-settle rate (human-attributed gates over answered gates) and a human-wait summary (median and upper-bound wait across human-attributed gates), and SHALL list never-answered gates alongside the rate rather than excluding them, so the number prices how much supervision the corpus's gates actually demanded. Runs whose gate events cannot support the join — torn or missing presentation records — SHALL report the metric at reduced coverage with an explicit unknown, never an error, and the era-contamination flag SHALL exclude development-era runs from the aggregate exactly as for every other corpus metric.

#### Scenario: Hand-settled gate attributes human with its wait

- **WHEN** a corpus gate was answered with no auto-decision record emitted around the settle
- **THEN** the gate attributes to human, and its presented-to-answered latency lands in the human-wait summary

#### Scenario: Waiter-claimed gate attributes by its record

- **WHEN** a gate was claimed at deadline expiry by the waiter, whose `auto_decision` lands after its write
- **THEN** the gate attributes to waiter, distinguishable from policy and human origins in the same report

#### Scenario: The rate is honest about pending gates

- **WHEN** a corpus run's four presented gates show three human-settled answers and one never-answered gate still pending
- **THEN** the aggregate reports the human-settle rate over the three answered gates and lists the pending gate beside it, so an unattended gate cannot hide inside a favorable rate

#### Scenario: An unjoinable gate degrades to unknown

- **WHEN** an inherited run's log carries an answered event whose presentation records are torn or absent
- **THEN** that gate's attendance attribution reports unknown with its reason instead of defaulting to an origin
