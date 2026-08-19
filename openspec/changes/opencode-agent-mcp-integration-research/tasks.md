<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: MCP integration research for the agent pipeline

Docs-only change (see `proposal.md` — Non-goals): no `src/`, test, or workflow
edits anywhere below. "Test-first" here means evidence-first — every live
claim is recorded before the document asserts it.

## 1. Recorded evidence — SDK surface and CI constraints

- [x] 1.1 Record the `mcp` config surface from the pinned SDK:
      `McpLocalConfig` / `McpRemoteConfig` / `McpOAuthConfig` fields with the
      `types.gen.d.ts` file:line anchors, and each runtime endpoint
      (`POST /mcp`, `/mcp/{name}/connect|disconnect|auth`, `GET /mcp`) judged
      for unattended usability. Note both pin versions (SDK types vs server
      binary) so a later bump knows what to re-verify.
      Verify: `sed -n '1462,1503p' opencode-agent/node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts`
- [x] 1.2 Compile the CI-constraint facts with citations, not re-derivation:
      S3-9 (model-readable server env), S3-7, workflow/README facts on
      masking, egress, ephemeral home. Capture where each is stated.
      Verify: `grep -n 'S3-7\|S3-9' opencode-agent/ROADMAP.md`

## 2. Live verification — the real binary, pid-disciplined

- [x] 2.1 Write the throwaway stdio MCP server (minimal JSON-RPC responder,
      placeholder token values only) into the job's temp dir — nothing
      committed, nothing installed. Every spawn records its pid and every
      experiment carries a timeout.
      Verify: `git status --porcelain` (empty — no residue)
- [x] 2.2 Feed `OPENCODE_CONFIG_CONTENT` with an `mcp` block to the real
      `opencode` binary and record: tool naming as `<server>_<tool>`, startup
      failure degradation (blocked vs tools-absent, never a hang), and
      `enabled: false` semantics. Kill experiment processes by recorded pid
      only — never `pkill`/`killall` (the control plane is a loopback
      `opencode serve`).
      Verify: `bun run opencode-agent:test:survival` (control plane alive after)
- [x] 2.3 Verify merge-vs-override semantics between a checkout-local config
      file and `OPENCODE_CONFIG_CONTENT`, and whether review-loop subprocesses
      (spawned with the env var set) see the checkout-local file at all —
      the smuggle-in-config question for the repo-file option.
      Verify: recorded in the document with the **verified** label and the fed
      config reproduced
- [x] 2.4 Confirm the permission key form that grants `<server>_<tool>` tools
      (e.g. `<server>_*` wildcard) against the resolved rules the binary
      reports — same method as the existing plan/build permission table.
      Verify: recorded in the document with the **verified** label and the fed
      config reproduced
- [x] 2.5 Record the OAuth dead end (`McpStatusNeedsAuth`, browser flow) and
      the `ask`-permission deadlock as unusable unattended — by inspection if
      it cannot be exercised without a browser.
      Verify: claim carries its **by inspection** / **verified** label

## 3. The document

- [ ] 3.1 Create `opencode-agent/docs/mcp-integration-research.md` with the
      SPDX licence header and the conventions of the existing docs
      (`remaining-findings-evaluation.md`, `review-command-plan.md`): §1 the
      SDK config surface from 1.1, §3 the CI possibilities from 1.2 applied
      per option.
      Verify: `bun run format:check`
- [ ] 3.2 Write §2 — the comparison core: every candidate surface
      (repo-committed file, `AGENT_*` env knob, repo-file + Actions-secrets
      interpolation, forked workflow, issue/comment-level) scored on the fixed
      dimensions from `design.md` D5, with issue/comment-level configuration
      explicitly rejected on security grounds, not omitted.
      Verify: `grep -c 'Scenario\|by inspection\|verified' opencode-agent/docs/mcp-integration-research.md`
      (every behavioural claim carries a label)
- [ ] 3.3 Write §4–§6: the deny-by-default permission interaction and grant
      shape (both profiles + global default, opt-out as a named follow-up),
      the injection point per option for both execution paths so they cannot
      drift, the credential-exposure risk per option with the
      proxy-placeholder/scrubbing generalisation assessment deferred, and the
      ranked recommendation with named follow-ups.
      Verify: `grep -n 'Recommendation\|follow-up' opencode-agent/docs/mcp-integration-research.md`
- [ ] 3.4 Optionally add the one-line link in `opencode-agent/ROADMAP.md` —
      only if the research surfaced a follow-up worth tracking (`design.md`
      Open Questions). Skip without comment otherwise.
      Verify: `git diff --stat` (confined to the two named files)

## 4. Final verification

- [ ] 4.1 Run the full suite and checks over the docs-only diff, confirm the
      licence-header gate passes on the new file, and confirm no
      `docs/architecture/*.md` pages are affected (none are — the deliverable
      lives in the workspace).
      Verify: `bun run test && bun run typecheck && bun run lint && bun run format:check`
