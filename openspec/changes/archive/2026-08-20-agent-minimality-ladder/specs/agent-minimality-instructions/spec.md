<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Defines the minimality rule this repository gives an agent before it writes production
code — its single definition, which instruction surfaces must carry it, and the two
things it may never be read to permit.

## ADDED Requirements

### Requirement: The minimality rule has one definition

The repository SHALL hold the minimality rule's text in exactly one named constant.
Every instruction surface that carries the rule SHALL carry that constant's text
rather than a restatement of it, and a test SHALL fail when a carrier's text and the
constant diverge.

#### Scenario: A carrier softens the rule

- **WHEN** an instruction block that must carry the rule is edited to paraphrase,
  shorten, or weaken it
- **THEN** the test asserting that carrier against the constant fails
- **AND** the divergence is reported as a failure of that carrier, naming it

#### Scenario: A new instruction surface is added

- **WHEN** a new instruction block asks an agent to write production code
- **THEN** it carries the constant's text
- **AND** it is covered by the same assertion as the existing carriers

### Requirement: Agents that write production code receive the rule

The instruction surfaces that ask an agent to write or change production code SHALL
carry the minimality rule. This covers the review loop's fix and retry prompts, the
autonomous pipeline's implementation phase, and its CI-fix phase.

#### Scenario: Implementation work is dispatched

- **WHEN** an agent is instructed to implement a plan step or to fix a red check
- **THEN** the instructions it receives carry the minimality rule
- **AND** the rule is stated as applying after comprehension, never as a reason to
  read less of the affected code

#### Scenario: Artifact drafting is dispatched

- **WHEN** an agent is instructed to draft a proposal, design, spec or task list
- **THEN** those instructions do not carry this rule
- **AND** the omission is deliberate, because artifact scope is governed separately

### Requirement: The rule never authorises cutting a safeguard

The minimality rule SHALL state that a smaller diff is not the goal, and that input
validation at trust boundaries, error handling, security, and tests are never reduced
to reach one. A carrier that omits this clause SHALL fail its assertion.

#### Scenario: An agent could satisfy an instruction by removing a check

- **WHEN** an agent applying the rule could produce a smaller change by dropping
  validation, error handling, a security control, or a test
- **THEN** the rule it was given forbids that reading explicitly

#### Scenario: The brake is edited out of a carrier

- **WHEN** a carrier retains the ladder but omits the clause naming what is never cut
- **THEN** the assertion for that carrier fails

### Requirement: Repository conventions override the rule where they conflict

Where the minimality rule and an enforced repository convention disagree, the
convention SHALL win and the rule as adopted SHALL NOT contain the conflicting
guidance. In particular, the rule SHALL NOT instruct an agent to minimise file count,
because a `max-lines` failure in this repository is a signal to split a file.

#### Scenario: An agent faces a file that has grown past the lint limit

- **WHEN** an agent applying the rule encounters a `max-lines` or
  `max-lines-per-function` failure
- **THEN** nothing in the rule it was given advises keeping the code in one file
- **AND** the repository convention to split the file or extract functions stands
  unopposed
