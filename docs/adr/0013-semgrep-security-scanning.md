<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0013: Semgrep Security Scanning Integration

## Status

Accepted

## Date

2026-03-18

## Context

papai integrates with OpenAI-compatible LLMs via the Vercel AI SDK and handles user-supplied natural language that flows into prompts and tool calls. This creates several AI/LLM-specific attack surfaces (prompt injection, hardcoded API keys, missing refusal checks) in addition to ordinary TypeScript/JavaScript vulnerabilities. The project had no automated static analysis for security issues, meaning security regressions could ship undetected.

The team needed a scanning solution that could run both locally during development and in CI on every PR and push to master, producing results developers could act on without manual review overhead.

## Decision Drivers

- LLM-specific attack surfaces (prompt injection, hardcoded API keys) require specialised rules beyond generic linters
- Scanning must integrate into the existing GitHub Actions workflow without requiring a paid Semgrep account
- Results must be surfaced in GitHub's Security tab (SARIF upload) for visibility
- Local developer workflow must remain low-friction (single command, no mandatory sign-in)
- The Bun runtime makes installing Python-based tools non-trivial; the runner must handle binary acquisition transparently

## Considered Options

### Option 1: Semgrep OSS with Docker runner and cloned AI rules (chosen)

- **Pros**: No Semgrep account required; AI-specific rules from `semgrep/ai-best-practices` repo available without a paid plan; Docker runner works cross-platform; local binary fallback available; SARIF output supported
- **Cons**: Docker dependency adds latency on first CI run; local runs require Docker or a native semgrep binary

### Option 2: Semgrep App (SaaS) with managed rules

- **Pros**: Simpler CI configuration; managed rule updates; PR comments built-in
- **Cons**: Requires a paid plan for private repos; introduces an external account dependency; AI best practices rules still need to be applied separately

### Option 3: CodeQL only

- **Pros**: Native GitHub integration; no external tool required; free for public repos
- **Cons**: No AI/LLM-specific rules; JavaScript/TypeScript analysis is less targeted for the patterns papai uses; slower to configure custom rules

### Option 4: npm audit + manual review

- **Pros**: Zero setup
- **Cons**: Only covers dependency vulnerabilities, not code-level issues like prompt injection or hardcoded secrets in logic

## Decision

Integrate Semgrep OSS using a TypeScript runner script (`scripts/run-semgrep.ts`) that:

1. Prefers a native `semgrep` binary from `PATH` (used in CI after `pip install semgrep`)
2. Falls back to a Docker-based runner (`semgrep/semgrep:1.156.0` image) for local development
3. Clones `semgrep/ai-best-practices` rules from GitHub at scan time
4. Runs the standard `p/owasp-top-ten`, `p/typescript`, and `p/javascript` rulesets alongside the AI-specific rules
5. Produces SARIF output in CI mode for GitHub Security tab upload

A dedicated `security` job is added to `.github/workflows/ci.yml`, running in parallel with existing lint/typecheck/test jobs.

## Rationale

The Docker-based local runner eliminates the need for developers to install Semgrep globally while keeping CI clean (native binary). Cloning the AI rules repo at scan time (shallow clone) ensures rules stay current without pinning to a specific commit. Running as a parallel CI job keeps overall pipeline latency unchanged.

The implementation deviates from the original design in one respect: the runner uses a versioned Docker image (`semgrep/semgrep:1.156.0`) rather than downloading a platform-specific binary, making it more portable and easier to update by changing a single version constant.

## Consequences

### Positive

- All commits and PRs are scanned for AI/LLM-specific vulnerabilities automatically
- SARIF results appear in the GitHub Security tab without manual action
- Developers can run `bun security` locally without any semgrep installation
- The `security:ci` script generates machine-readable JSON and SARIF for downstream processing
- No Semgrep account or API key required

### Negative

- First local scan requires Docker and involves pulling a ~500MB image
- AI best practices rules are re-cloned on each CI run (mitigated by GitHub Actions cache if added later)
- The `--ci` flag in the original design was simplified; CI and local modes now share the same entry point with output format determined by the SARIF argument

## Implementation Status

**Status**: Implemented

Evidence:

- `.semgrep/config.yml` — configuration file with `p/owasp-top-ten`, `p/typescript`, `p/javascript` rulesets
- `.semgrep/ai-best-practices/` — cloned AI rules directory (gitignored)
- `scripts/run-semgrep.ts` — runner script with Docker fallback and native binary preference; uses `semgrep/semgrep:1.156.0`
- `.github/workflows/ci.yml` lines 17–37 — `security` job that runs `bun security` and uploads SARIF via `github/codeql-action/upload-sarif@v4`
- `package.json` — `security` and `security:ci` scripts present
- `CLAUDE.md` — Security section documents `bun run security` and `bun run security:ci` commands

The pre-commit hook integration was partially implemented: `scripts/pre-commit.sh` exists and is wired as the active `.git/hooks/pre-commit`, but it runs `./scripts/check-quiet.sh` (which runs lint, typecheck, format:check, knip, test, duplicates, mock-pollution) rather than `bun security`. Semgrep scanning is not included in the pre-commit hook; it runs only in CI and on-demand locally via `bun security`.

## Related Plans

- `/Users/ki/Projects/experiments/papai/docs/plans/done/2026-03-18-semgrep-security-integration.md`
- `/Users/ki/Projects/experiments/papai/docs/plans/done/2026-03-18-semgrep-integration-implementation.md`
