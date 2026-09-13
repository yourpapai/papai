# Hosted repo-digest agent — repo & artifact reading for papai without raw API token burn

## Goal

The in-chat assistant can only reach papai's own repository today through `web_fetch` (`src/tools/web-fetch.ts`, public HTTP(S), size-capped) or raw API fetches — both burn large token budgets per byte and cannot scale past trivial lookups. When an agent run saves its deliverables as files (e.g. `reports/audit/issue-448/behavior-safety-audit.md` on an `agent/issue-448` / `audit-output` ref, published by `.github/workflows/behavior-audit.yml` via an orphan branch), the owner never learns what is inside.

This change adds a **hosted digest agent**: the assistant issues instructions; a separate GitHub-Actions-hosted agent downloads/reads the repo content and artifacts **on the runner**, digests locally (grep/read/extract + one bounded model turn), and returns a **compact, hard-capped structured digest** back into the chat. Smallest end-to-end slice: one real round-trip that answers the motivating case — fetch and summarize `reports/audit/issue-448/behavior-safety-audit.md` — or report precisely why it cannot.

## Inventory — what exists and is reusable (verified in-repo)

- **Hosting & triggering**: `opencode-agent/` is an event-driven Actions pipeline (`.github/workflows/agent-pipeline.yml`); one CI job = one `runCli` call (`opencode-agent/src/index.ts`). Triggers are issue/PR/red-CI/merged-PR only — this change adds a **new `workflow_dispatch` door** (a new workflow file), touching none of the issue/PR trigger rules (issue #451 territory stays untouched).
- **Authenticated code-read path already exists**: the agent job checks out the repo (`fetch-depth: 0`, `persist-credentials: false`) and the pipeline switches branches itself; a digest run gets the whole tree at any ref for free, plus `actions: read` on `GITHUB_TOKEN` to download run artifacts.
- **Agent runtime seams to reuse**: `AgentSession` (`src/agent-session.ts`, opencode/claude backends), deny-by-default capability profiles (`openai-config.ts`), `scrubSecrets` before any spawn (`secrets.ts`), transcript, zod-validated `promptForJson`. The `plan` profile is read-only but cannot run commands; a digest run needs grep/read, so the digest entrypoint uses its own narrow profile (read + bash, no git write, no edit) rather than reusing `build`.
- **Artifact machinery**: `actions/upload-artifact` + artifact download is proven by the encrypted debug-transcript (`debug-transcript-<run_id>`, 7-day retention); Actions artifacts are downloadable by anyone with repository read — acceptable for a secret-redacted digest.
- **papai side**: tool conventions (`src/tools/CLAUDE.md`: one file per tool, `make[Action]Tool`, snake_case, `tool-metadata.ts` domain/risk registration, fail-closed assembly gates like `run_diagnostics`' admin/DM/normal gate); forge GitHub credentials exist (`src/coding-credentials/types.ts`) but are per-config-context user credentials for push/PR — a hosted digest is a machine-to-machine concern and gets its own central config (assumption below).
- **No existing change covers this**: `openspec/changes/` has no digest/reader change (checked); `openspec/specs/` corpus has no adjacent capability.

## Design

### 1. Invocation — a papai tool

New tool `repo_digest` (`src/tools/repo-digest.ts`, `makeRepoDigestTool`, registered in `tool-metadata.ts` under the `coding` domain as read-tier: it mutates nothing, but triggers an Actions run and spends hosted LLM tokens, so per-context `tool_prefs` can `ask`/`deny` it). Input schema (zod, `.describe()` everywhere):

- `instruction: string` — what to do (natural language);
- `questions: string[]` — the specific questions to answer;
- `target`: `{ kind: 'repo' | 'pr' | 'issue' | 'run', ref?: string, path?: string, artifact?: string }` — repo ref (branch/tag/sha, default base branch), path or artifact coordinates.

Execution: dispatch → poll → download (new `src/github-actions/digest-client.ts`, DI'd HTTP seam so tests run offline):
1. `POST /repos/{repo}/actions/workflows/{digest-agent.yml}/dispatches` with a request JSON input (ref: base branch; request rides the inputs).
2. Poll `GET .../actions/runs/{id}` (created via the dispatch response + `created` filter) with a bounded wait (~3 min, `p-limit`-safe single poller, clear timeouts).
3. On completion, download artifact `digest-<run_id>`, unzip, read `digest.json`, re-check the size cap, return it as the tool result (papai's own compaction wrapper still applies).

Gating: the tool assembles only when the digest config is present (fail-closed, like `run_diagnostics`) — no config, no tool.

### 2. Hosting — reuse Actions runners (decision)

New workflow `.github/workflows/digest-agent.yml`: `workflow_dispatch` only, `permissions: { contents: read, actions: read }`, `timeout-minutes: 10`, one concurrency group `digest-agent` (`cancel-in-progress: false`), gated on the same maintainer-only vars/secrets pattern as agent-pipeline. Steps: checkout (full history) → optional `gh run download`/artifact fetch for `run` targets (runner-side, so the token never reaches the model) → run `opencode-agent` digest entrypoint (`opencode-agent/src/digest.ts`, new `--digest-request <file>` mode beside `runCli`) → upload `digest.json` (or `digest-error.json`) as artifact `digest-<run_id>` with `if: always()`. LLM credentials reuse the existing `LLM_API_KEY`/`LLM_BASE_URL`/`LLM_MODEL` wiring; `GITHUB_TOKEN` is scrubbed from the model process env per the existing `secrets.ts` doctrine.

**Trade-offs stated**: hosted runners give cold-start latency (~1–3 min queue + checkout) and public-runner availability risk, but zero always-on cost, zero new deployment/credential surface, and reuse the maintained agent runtime. An always-on service would cut latency but needs a host, lifecycle, secrets, and a second copy of the read tooling — rejected for now; the workflow door is the smallest thing that works and the digest contract stays identical if it ever moves.

### 3. Digest contract (TDD target)

Shared zod schemas (one module on the papai side, mirrored/recorded on the agent side):
- Request: `{ request_id, instruction, questions[], target }`.
- Response: `{ status: 'answered' | 'not_found' | 'partial', summary: string, findings: [{ file: string, ref?: string, lines?: string, quote?: string, note?: string }], truncated: boolean, run_url: string }`.
- **Hard cap** (agent-side, before upload, and re-checked tool-side): total serialized digest ≤ 4000 chars, ≤ 8 findings, quotes ≤ 200 chars; over-cap → oldest findings dropped, `truncated: true`.
- **Secrets never travel**: the digest prompt/system rules forbid quoting env/secrets; a deterministic redaction pass (`ghp_`, `github_pat_`, `AKIA`, bearer/token-shaped patterns) runs over the digest before it is written; the model process holds no token at all.

### 4. Failure modes — degrade with a clear message, never silence

- Runner queued/unavailable past the bounded poll → structured `{ status: 'pending', run_url }` result telling the user to ask again shortly (the tool may also be re-invoked with the run id).
- Run failed → `digest-error.json` artifact (reason: missing artifact, path not found, oversized input, model error) → precise message naming the reason + run URL; no digest artifact and no error artifact → failure message with run URL only.
- Missing artifact / path → digest agent returns `status: 'not_found'` naming the exact ref+path probed.
- Oversized content → cap + `truncated: true`.
- Dispatch rejected (403/404, bad token scope) → structured tool failure naming the missing `actions: write` scope/config.

## Files to touch

- `.github/workflows/digest-agent.yml` (new);
- `opencode-agent/src/digest.ts` (new entrypoint: request parse, narrow profile, one bounded turn, cap + redaction, digest.json/error writer) + small additions to `opencode-agent/src/` it reuses (config reads already exist);
- `src/github-actions/digest-client.ts` (new: dispatch/poll/download, DI'd fetch);
- `src/tools/repo-digest.ts` (new tool), `src/tools/tool-metadata.ts` (registration), `src/tools/provider-independent-tools-builder.ts` (fail-closed assembly);
- `.env.example` + `docs/architecture/environment.md`: central config keys — assumption: `DIGEST_AGENT_REPO`, `DIGEST_AGENT_WORKFLOW`, `DIGEST_AGENT_TOKEN` (PAT with `actions: write` + read on the target repo) instead of reusing per-user forge credentials;
- tests: `tests/repo-digest/` (client against a fake GitHub API: dispatch 202→poll→artifact zip→cap re-check; tool gating + failure messages) and `tests/opencode-agent/digest.test.ts` (request/response contract, size cap, redaction, not_found path).

## Intended behaviour change

Downstream-observable: the assistant gains a new capability — asking a hosted agent to read repo/artifact content and answer with a compact digest in chat. New workflow door (`workflow_dispatch`) that never touches the issue/PR trigger rules. No public API, no chat-side repo-browsing UI.

## Verification

- TDD first for the request/response zod contract, the size cap (over-cap truncation sets `truncated`), and the redaction pass, then the client/tool.
- Gates before finishing: `bun test`, `bun run typecheck`, `bun run lint`, `bun check:full`.
- Round-trip integration: CI runs the client/tool against a faked GitHub API; the true end-to-end (assistant request → hosted agent → digest in chat) is exercised once live on the motivating case — request `reports/audit/issue-448/behavior-safety-audit.md` — with the result (digest, or the precise `not_found` reason) recorded in the short report.

## Capabilities

- `repo-digest-agent` (new — no existing capability covers assistant-initiated hosted repo/artifact reading; `openspec/specs/` has no adjacent corpus entry).

## Non-goals

- No general chat-side repo-browsing UI; no new public API; no changes to issue/PR trigger rules (#451 territory).
- No always-on digest service, no digest caching/indexing layer, no arbitrary file upload to chat.

## Assumptions to veto at review

- papai authenticates to dispatch with a dedicated central credential (`DIGEST_AGENT_*` env/central config), not a per-user forge token — wrong guess is a one-line config swap, flagged in the spec.
- The digest travels back as a run artifact that papai downloads, not as an issue comment (keeps chat noise at zero and the answer structured); if the owner prefers a comment mirror, it is an additive workflow step later.
