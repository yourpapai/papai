<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Owns the claude route's OAuth credential rules as a recorded fact rather than
an admitted-but-broken spelling: the startup refusal, the no-carrier invariant
the recordings established, and the standing negative pins that re-assert both
whenever the pinned CLI moves.

## ADDED Requirements

### Requirement: The OAuth spelling is refused at startup, with the recorded reason

When the claude backend is selected, a set `CLAUDE_CODE_OAUTH_TOKEN` SHALL
fail job startup loudly — alone or beside a set `ANTHROPIC_API_KEY` — with a
failure distinguishable by its error code from other startup failures, before
any CLI process is spawned and before any model spend. The failure message
SHALL name the variable and state the recorded reason: the token is not
necessarily invalid — this route's `--bare` invocations have no carrier for
it (the environment spelling is never read, and the CLI's `apiKeyHelper`
mechanism, which does load it, cannot authenticate an OAuth token to the
API). `ANTHROPIC_API_KEY` alone SHALL remain the route's sole accepted
credential state; the neither-set failure SHALL keep naming the API key as
the accepted spelling. The guard SHALL NOT fire on the `opencode` route, and
the gateway-credential refusal (`LLM_API_KEY`) is unchanged.

#### Scenario: The OAuth spelling alone fails at startup

- **WHEN** `AGENT_BACKEND=claude` and only `CLAUDE_CODE_OAUTH_TOKEN` is set
- **THEN** job startup fails naming the variable and the recorded no-carrier reason, under the credential failure code, and no `claude` process is spawned

#### Scenario: Both spellings set still fails at startup

- **WHEN** `AGENT_BACKEND=claude` and both credentials are set
- **THEN** job startup fails naming both variables before any spawn — the OAuth spelling is refused on this route whatever accompanies it

#### Scenario: The API-key state and the opencode route are unaffected

- **WHEN** the claude backend runs with only `ANTHROPIC_API_KEY`, or any job runs with `AGENT_BACKEND` unset or `opencode`
- **THEN** startup proceeds exactly as the parent change's guard prescribes, and the OAuth refusal neither fires nor rewrites the environment

### Requirement: The route ships no credential-file carrier

The claude route SHALL NOT materialize credential-bearing files into the
job-scoped config dir: no helper script, no settings file naming one, and no
invocation SHALL carry `--settings` naming such a file. The route's only
credential carrier is the spawned CLI's environment carrying exactly the
API key on the accepted spelling. The session's credential option SHALL
remain optional, so the recorder can boot a deliberately un-credentialed
adapter for its auth-error leg — an absent credential spawns carrying no
Anthropic value anywhere. The init line's credential-source fact SHALL
remain a decoded, recorded shape (it pinned the finding), read by the
recorder, ignored by the turn pipeline.

#### Scenario: No credential files ride a job

- **WHEN** a job runs the claude backend with the accepted API-key spelling, from boot through teardown
- **THEN** the job-scoped config dir never contains a credential script or a settings file naming one, and no invocation's arguments carry `--settings`

#### Scenario: The credentialless boot stays representable

- **WHEN** the recorder boots the adapter with no credential
- **THEN** the boot and its spawns carry no Anthropic credential in any environment, argument, or file, and the un-credentialed turn fails with the recorded auth-error shape

### Requirement: The recorded negative stays pinned across CLI pin moves

The recorder SHALL carry a standing, un-credentialed negative leg that
re-asserts the recorded finding at zero model spend: with a deliberately
invalid token materialized through the CLI's own `apiKeyHelper` shape and
named via `--settings` on a `--bare` invocation, the leg SHALL observe the
init line reporting the helper as the credential source and the turn ending
in the recorded API-refusal shape — helper loaded, OAuth refused. The
recorded corpus SHALL keep the helper-leg init-line fixture and its
provenance note stating what was attempted, what loaded, and what the API
refused, so the dead end is documented by observation rather than folklore.
A CLI pin move that changes either half (helper no longer loads, or OAuth
over the helper starts succeeding) SHALL surface as a recorder failure that
names the change.

#### Scenario: The dummy-token helper leg re-records the dead end

- **WHEN** the recorder's un-credentialed OAuth leg runs a `--bare` invocation whose only credential is a dummy token behind an `apiKeyHelper` named via `--settings`
- **THEN** the init line reports the helper as the credential source and the turn fails with the recorded API-refusal shape, and any deviation fails the recorder loudly

#### Scenario: The provenance fixture stays truthful

- **WHEN** the fixture corpus is read
- **THEN** the helper-leg init-line fixture and its README entry state the recorded outcome — loaded by the CLI, refused by the API — stamped with the CLI version that produced it
