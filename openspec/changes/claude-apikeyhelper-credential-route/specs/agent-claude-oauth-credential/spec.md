<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Lets the claude backend's OAuth spelling actually authenticate: the subscription
token is delivered to the pinned CLI through its sanctioned `apiKeyHelper`
mechanism in the job-scoped config dir, proven by recording, never assumed from
documentation.

## ADDED Requirements

### Requirement: The OAuth spelling is delivered through a job-scoped apiKeyHelper

When the claude backend's chosen credential is `CLAUDE_CODE_OAUTH_TOKEN`, the
pipeline SHALL deliver it to the CLI exclusively through the CLI's
`apiKeyHelper` mechanism: a helper script that emits the token, plus the
settings file naming it, both materialized inside the job-scoped config dir
before the first CLI spawn of the job. The settings file SHALL be mode 0600 and
the helper script mode 0700 (it must execute), both inside the already
job-scoped config dir, readable by the job's own user only. The token SHALL NOT appear in any spawned
process's environment or in any CLI argument on this spelling; the environment
of a CLI spawn on this spelling SHALL carry no Anthropic credential at all. The
`ANTHROPIC_API_KEY` spelling is unchanged: it keeps direct environment
injection and no helper is materialized for it.

#### Scenario: OAuth turn spawns with no credential in the environment

- **WHEN** the chosen credential is `CLAUDE_CODE_OAUTH_TOKEN` and a turn spawns the CLI
- **THEN** the CLI's environment carries neither Anthropic credential spelling, and the argv carries no credential, while the job-scoped config dir holds the helper script (mode 0700) and the settings file naming it (mode 0600)

#### Scenario: API-key turns materialize nothing

- **WHEN** the chosen credential is `ANTHROPIC_API_KEY` and turns spawn the CLI
- **THEN** the config dir holds no helper script or credential-naming settings, and the environment carries exactly the API key as before

#### Scenario: No helper state survives a job

- **WHEN** a job that materialized the helper ends and a later job starts on the same issue
- **THEN** the later job's config dir contains no helper or settings from the earlier job, exactly as the route's clean-state rule already requires

### Requirement: The helper mechanism is proven by recording on the pinned CLI

The claim that `apiKeyHelper` authenticates under `--bare` on the pinned CLI
version SHALL be established by a credentialed recording, not assumed from
documentation: the recorder, driven with the OAuth token as its chosen
credential, SHALL record a successful turn whose init line reports a
non-`none` credential source, and the recorded corpus SHALL pin the init-line
shape that carries it. Until that recording exists, no job on the OAuth
spelling may be considered supported. If the recording demonstrates the helper
is not consulted under `--bare` on the pinned version, the change SHALL NOT
ship the helper route; the recorded outcome then removes the OAuth spelling
from the guard's accepted spellings instead, and this change's artifacts are
revised through the update workflow to say so.

#### Scenario: The recorder pins the helper authenticates

- **WHEN** the credentialed recorder runs with `CLAUDE_CODE_OAUTH_TOKEN` as its credential on the pinned CLI
- **THEN** a turn resolves with real reply text, its init line's credential source is recorded as active (not `none`), and the corpus fixture carries that init-line shape stamped with the CLI version

#### Scenario: Documentation reflects the recorded outcome

- **WHEN** the recording completes either way
- **THEN** the operator documentation describes the OAuth spelling by its recorded mechanism — helper-carried and proven, or removed — with no caveat left pending

### Requirement: Secret-handling rules hold for the file-borne token

The OAuth token value SHALL remain covered by the pipeline's secret handling
end to end: it joins the scrub set by value, is redacted from any log, state
block, or transcript entry by value, and never appears in an error message.
The helper file is an additional carrier of the value inside the job only: it
SHALL live solely in the job-scoped config dir, which teardown removes with
the rest of the job's CLI state. Error and log messages about the helper route
SHALL name variables and file roles, never values. The recorded residual that
same-user children of the CLI's own `Bash` tool can read the credential is
acknowledged and unchanged by the carrier move: it is a mechanism change, not
a security boundary, and the documentation SHALL keep stating it.

#### Scenario: Redaction covers the helper-carried token

- **WHEN** stream content or a failure diagnostic on the OAuth spelling would carry the token value
- **THEN** the transcript and any public log receive a redaction placeholder instead, exactly as for the env-borne spellings

#### Scenario: Teardown removes the credential file with the job

- **WHEN** a job on the OAuth spelling tears down
- **THEN** the config dir that held the helper is removed by the existing teardown path, and no credential file outlives the job
