<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev. Use of this software is governed by the Business Source License 1.1. See LICENSE in the project root for details. -->

## Purpose

Gives a maintainer a `/fix` command that asks the GitHub Actions coding agent to repair the failed checks of its own pull request, so red checks the automatic red-run event never delivered — cancelled, dropped, or left by a human push — still reach the agent's existing CI-repair run.

## ADDED Requirements

### Requirement: `/fix` enters the existing CI-repair run

The system SHALL provide a `/fix` slash command that enters the CI-fix repair run through the same state transition the automatic red-run door uses. A `/fix` round SHALL be an ordinary CI-fix round: it consumes one CI-fix attempt from the same per-pull-request budget, and its diagnosis, repair, reporting and outcome behavior SHALL be that of the CI-repair capability — the command adds a door, not a second repair path.

#### Scenario: Accepted on a red pull request

- **WHEN** a maintainer replies `/fix` on the agent's own open pull request of a delivered issue whose checks are red, and no usable red-run event arrived — the red run was cancelled rather than finishing red, the transition table refused it, or a human push left the checks red mid-review
- **THEN** the agent SHALL start a CI-fix round against that pull request and answer on the pull request with the round's outcome

#### Scenario: The round addresses the pull request's own checks

- **WHEN** `/fix` starts a repair round
- **THEN** the round SHALL discover what failed from the check runs of the pull request's head commit through the Checks API — never by parsing a run URL, and never from a memorized check list

#### Scenario: Nothing red on the head

- **WHEN** `/fix` is accepted and the addressed check runs expose no failed job
- **THEN** the round SHALL report that no failed check run could be found rather than claiming the checks passed, and SHALL push nothing

#### Scenario: One budget shared by both doors

- **WHEN** a pull request has spent CI-fix attempts through the automatic red-run door and a maintainer then replies `/fix`
- **THEN** the `/fix` round SHALL count against the same per-pull-request CI-fix budget, and the reverse SHALL hold equally

### Requirement: `/fix` is gated like the other pull-request commands

The system SHALL accept `/fix` only when the persisted state names a pull request and the phase is one that admits the CI-failed transition; in every other state the command SHALL be refused with the ordinary wrong-command refusal listing the commands that state does accept. `/fix` SHALL appear in that offered list exactly for the states that accept it, so the offer and the gate cannot disagree.

#### Scenario: Accepted where a red run would be acted on

- **WHEN** `/fix` is typed on the agent's pull request of an issue in `COMPLETE` — or in the delivery phase the automatic door also admits — whose state names that pull request
- **THEN** the command SHALL be accepted

#### Scenario: Refused before a pull request exists

- **WHEN** `/fix` is typed on an issue whose state names no pull request — nothing has been pushed to repair
- **THEN** the command SHALL be refused with the wrong-command refusal listing the commands that do apply, and no CI-fix attempt SHALL be spent

#### Scenario: Refused in a phase that does not admit it

- **WHEN** `/fix` is typed in a phase the CI-failed transition refuses — a failure park (`FAILED`), a wall-clock park (`INCOMPLETE`), or any phase before the branch exists
- **THEN** the command SHALL be refused with the wrong-command refusal listing the commands that do apply

#### Scenario: Typed on the issue once the pull request exists

- **WHEN** `/fix` is typed on the issue of a state that names a pull request
- **THEN** the run SHALL reply with the surface refusal naming the pull request where the command belongs, and SHALL NOT act on the command

### Requirement: A spent CI-fix budget is refused before the command is applied

`/fix` past the CI-fix ceiling SHALL be turned down before the state move is applied: nothing SHALL be parked, and the persisted state SHALL keep its phase, its CI-fix count and its pull-request identity unchanged, so raising the ceiling makes the very same `/fix` work. The refusal SHALL name the CI-fix ceiling and the remedies that actually hold: raising it, or the fresh CI-fix budget a new pull request earns. Because the refusal answers a command somebody typed, it SHALL be delivered every time the command is typed, unlike the automatic door's once-per-pull-request budget notice.

#### Scenario: Refused with the state untouched

- **WHEN** a maintainer replies `/fix` on a pull request whose CI-fix budget is spent
- **THEN** the agent SHALL answer on the pull request naming the CI-fix ceiling and the remedies, and the persisted state SHALL be unchanged in phase and CI-fix count

#### Scenario: Raising the ceiling makes the same command work

- **WHEN** the CI-fix ceiling is raised in the workflow after a `/fix` budget refusal and the maintainer replies `/fix` again
- **THEN** the command SHALL be accepted and a repair round SHALL start

#### Scenario: The refusal repeats with the question

- **WHEN** `/fix` is typed again after a budget refusal
- **THEN** the refusal SHALL be posted again — the once-per-pull-request silence belongs to the automatic door, not to a typed command

### Requirement: The command rides the pull-request door's existing guardrails

`/fix` SHALL be recognized by the pull-request comment door under the same conditions as every other command: the pull request must be open, head the agent's own `agent/issue-<n>` branch, and come from this repository. A pull request from a foreign repository whose branch merely looks like the agent's SHALL keep its existing refusal, and `/fix` SHALL NOT widen it.

#### Scenario: Fork look-alike is still refused

- **WHEN** `/fix` is typed on an open pull request opened from a fork whose branch is named `agent/issue-<n>`
- **THEN** the run SHALL be refused the same way as every other command on that door, and no model turn or CI-fix attempt SHALL be spent

#### Scenario: The pull-request arm admits the command

- **WHEN** a maintainer types `/fix` on the agent's own open pull request
- **THEN** the comment SHALL start an agent job exactly as `/review` and `/sync` do
