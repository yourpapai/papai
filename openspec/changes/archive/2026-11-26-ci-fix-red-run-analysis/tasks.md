# Tasks: ci-fix-red-run-analysis

## 1. Trigger and API foundations

- [x] 1.1 Extend the `workflow_run` parse in `opencode-agent/src/trigger-events.ts` to carry `runId` beside `runUrl`; update the zod schema and trigger tests (guardrails untouched)
- [x] 1.2 Add `listRunJobs(runId)` and `jobLog(jobId)` to `GitHubApi` in `opencode-agent/src/github.ts` (jobs with per-step conclusions; log text redacted through the boundary `clean()`); record response fixtures from a live run
- [x] 1.3 Clip fetched logs with `clipTail` under a per-job budget in a new module beside `check-loop.ts`; tests for clipping and the failed-job/failed-step filter

## 2. Config removal

- [x] 2.1 Delete `opencode-agent/src/check-spec.ts` (`AGENT_CHECKS`, `DEFAULT_CHECKS`, `parseChecks`); drop `checks` from `PipelineConfig` and the `config-values.ts` re-export; update config tests
- [x] 2.2 Remove the `AGENT_CHECKS` export from `.github/workflows/agent-pipeline.yml` and any test pinning it (`workflow.test.ts`)

## 3. Diagnosis and repair

- [x] 3.1 Define the verdict schema (`fix` / `needs-human`, optional `reproduction.argv`, `humanReport`) with zod, and a `buildDiagnosisPrompt` in `prompts.ts` that envelops job/step facts and clipped log excerpts; instruction pins (envelope carry, minimality, protected-paths) asserted like the existing `instructions.test.ts` rows
- [x] 3.2 Rework `handleCiFix` in `opencode-agent/src/phases/ci-fix.ts`: fetch failed jobs/logs (catch fetch failures into the needs-human path), run the diagnosis turn through `promptForJson`, and branch on the verdict per design D3
- [x] 3.3 Scope `runCheckLoop` to the derived `reproduction.argv` (single-command scope; repair prompts carry local output plus the original log excerpt); passing locally while CI was red falls through to the log-based path, never to success
- [x] 3.4 Implement the log-based path: one repair turn from the log, commit and push through the existing `commitAndPush`, flagged so the report can say the verdict rests on log analysis
- [x] 3.5 Implement the needs-human path: no repair turn, no push, report from `humanReport` plus job/step facts; consumes one `ciAttempts` entry; `phases.test.ts` fake extended to cover all three branches

## 4. Reporting

- [x] 4.1 Extend the CI report renderer: needs-human lines (job, reason, remedy), log-based-fix line, and keep the job-scoped green/pushed honesty rules; renderer tests for every outcome in the spec's "Round reports distinguish every outcome"

## 5. Workflow, transcript, docs

- [x] 5.1 Add `actions: read` to the workflow-level permissions in `.github/workflows/agent-pipeline.yml`; verify `workflow.test.ts` and `bun workflows:lint` pass
- [x] 5.2 Fold diagnosis verdicts and log excerpts into the encrypted transcript only; public Actions log keeps names/counts (progress channel rule)
- [x] 5.3 Update `opencode-agent/README.md` and its `CLAUDE.md` local rules: remove `AGENT_CHECKS`, describe red-run-derived diagnosis and the needs-human verdict

## 6. Verification

- [x] 6.1 Full suite `bun run test`, plus `bun run lint`, `bun run typecheck`, `bun check:full`; confirm zero references to `AGENT_CHECKS` remain (`rg AGENT_CHECKS`)
