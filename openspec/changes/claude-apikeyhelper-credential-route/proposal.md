<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Why

The claude route's guard admits `CLAUDE_CODE_OAUTH_TOKEN` as a credential spelling, but no carrier can serve it on the `--bare` route — and on 2026-08-25 every path was settled by recording on the pinned CLI 2.1.239 with a token proven valid on the CLI's native path: `--bare` never reads the env token (recorded `apiKeySource: "none"`), and the CLI's own sanctioned `apiKeyHelper` mechanism loads it (`apiKeySource: "apiKeyHelper"`) only for the API to refuse the call with 401 — the helper is API-key-shaped. A set OAuth spelling today buys a first turn that fails `CLAUDE_RESULT` at real recording cost. The guard should say at startup what the recording proved.

## What Changes

- The claude route's guard **refuses the OAuth spelling**: `CLAUDE_CODE_OAUTH_TOKEN` set (alone or beside the API key) fails job startup loudly, with a failure distinguishable by code and a message naming the recorded facts — the token is not invalid; this route has no carrier for it. `ANTHROPIC_API_KEY` alone remains the route's sole accepted credential state; both-set and neither-set keep their existing failures.
- The helper route this change originally built is **retired from production**: the credential-file writer, the `--settings` argv composition, and the boot-time materialization go; what stays is the seam pieces the recordings made load-bearing — the optional `credential` (the recorder's un-credentialed leg needs credential-less boots) and the init line's `apiKeySource` decoder fact.
- The recorder's OAuth legs become **standing negative pins**: cheap dummy-token legs (zero spend) re-assert that `--bare` + helper still ends in the recorded 401 `api_error` shape whenever the CLI pin moves, with `oauth-helper-init.ndjson` and the corpus README keeping the provenance.
- `opencode-agent/README.md` resolves the parent change's "caveat pending the credentialed recording" to this recorded outcome; `CLAUDE.md` gains the route rule.

**Sequencing**: `claude-native-oauth-profile` (scaffolded on this branch) re-admits the spelling via a neutralized native profile, building on exactly these recordings; it applies only after this revision is merged. This change deliberately refuses the spelling and builds none of the successor's profile machinery.

## Capabilities

### New Capabilities

- `agent-claude-oauth-credential`: the claude route's OAuth credential rules as recorded — the startup refusal with its recorded justification, the no-helper-carrier invariant, and the standing negative recordings that keep the refusal honest across CLI pin moves.

### Modified Capabilities

None. `opencode-agent-claude-cli-backend` (the unarchived `build-claude-code-cli-as-a-selectable-model-backend-in-opencode` change) owns the route; it has no spec under `openspec/specs/` to modify. This change requires that change archived first and layers on its guard — the same layering `opencode-agent-fix-command` used over `agent-ci-repair`.

## Impact

- Code: `opencode-agent/src/config-backend-values.ts` (the refusal), retirement across `claude-credential.ts` (deleted), `claude-argv.ts` (drop `--settings` composition), `claude-adapter.ts` (drop materialization), with the matching test suites reworked.
- Recorder/fixtures: `tests/opencode-agent/claude-live.integration.ts` OAuth legs become dummy-token negative pins; `fixtures/claude-cli/` keeps `oauth-helper-init.ndjson` + README provenance.
- Workflow: none — the forwarding line stays; a set OAuth secret now fails loudly at startup, which is the desired signal, and workflow edits are maintainer-only by the parent change's rule.
- Docs: `opencode-agent/README.md`, `opencode-agent/CLAUDE.md`.
- No papai platform/task instance, scope-model, or SQLite impact (repository-scoped Actions configuration only).

## Non-goals

- Building any part of the native OAuth profile — that is `claude-native-oauth-profile`, sequenced after this change.
- Touching the API-key spelling's env injection or the bare route's argv (byte-identical after retirement, minus the never-shipped helper composition).
- Changing the workflow file or the secrets scrub/redaction set (the token value stays covered while the guard names it).
