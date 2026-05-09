# Review Loop: Config Fix + Progress Logging

Date: 2026-04-22

## Problem

The review-loop script has two issues:

1. **Invalid config** — `config.example.json` references a non-existent model (`kimi-k2-0711-ollama-cloud`) and a non-existent fixer binary (`/usr/local/bin/claude-acp-adapter`). Both need to use `opencode acp` with valid model IDs from `opencode models`.
2. **No progress output** — The loop runs silently until the final summary. There is no visibility into what happens during each round, which issues were found, which were fixed, or whether the loop is stalled.

## Design

### Config Fix

Both agents use `opencode acp` with different models set via `sessionConfig.model`. The `sessionConfig` keys map to ACP config option IDs; opencode exposes a config option with ID `model` (category `"model"`).

Updated `.review-loop/config.json`:

```json
{
  "repoRoot": ".",
  "workDir": ".review-loop",
  "maxRounds": 10,
  "maxNoProgressRounds": 2,
  "reviewer": {
    "command": "opencode",
    "args": ["acp"],
    "env": {},
    "sessionConfig": {
      "model": "ollama-cloud/kimi-k2.6:cloud"
    },
    "invocationPrefix": "/review-code",
    "requireInvocationPrefix": false
  },
  "fixer": {
    "command": "opencode",
    "args": ["acp"],
    "env": {},
    "sessionConfig": {
      "model": "opencode/claude-sonnet-4-6"
    },
    "verifyInvocationPrefix": null,
    "fixInvocationPrefix": null,
    "requireVerifyInvocation": false
  }
}
```

`config.example.json` is updated to match these corrected values. `.review-loop/` is already gitignored so the actual config stays local.

### Progress Logging

Introduce a `ProgressLog` interface and thread it through the loop controller via the existing dependency-injection pattern.

New file `scripts/review-loop/progress-log.ts`:

```typescript
export interface ProgressLog {
  log(message: string): void
}
```

The `ReviewLoopDeps` type gains a `log: ProgressLog` field. The loop controller emits progress at each stage with structured line prefixes for grep-ability.

#### Log Events

| Event                | Prefix        | Example Output                                             |
| -------------------- | ------------- | ---------------------------------------------------------- |
| Round start          | `[round N/M]` | `[round 3/10] Reviewing against plan...`                   |
| Issues discovered    | `[round N]`   | `[round 3] Found 4 issues (2 critical, 1 high, 1 medium)`  |
| Issue verification   | `[verify]`    | `[verify] "Missing error handling" → valid, auto-fixable`  |
| Fix attempted        | `[fix]`       | `[fix] "Missing error handling" → fix applied (attempt 1)` |
| Verification skipped | `[verify]`    | `[verify] "Deprecated API usage" → rejected`               |
| Re-review            | `[round N]`   | `[round 3] Re-review: 1 issue remaining`                   |
| Round summary        | `[round N]`   | `[round 3] Fixed 3/4 issues this round`                    |
| Stall warning        | `[round N]`   | `[round 5] No issues fixed this round (stall count: 1/2)`  |
| Loop end             | `[done]`      | `[done] clean after 3 rounds — 3 closed, 1 needs_human`    |

Title strings in verify/fix lines are truncated to 60 characters.

### Wiring in `cli.ts`

The CLI creates a `ProgressLog` backed by `console.log` and passes it as part of the deps to `runReviewLoop`. This keeps logging out of the loop controller's internals — it only knows about the interface.

### Files Changed

| File                       | Change                                                     |
| -------------------------- | ---------------------------------------------------------- |
| `config.example.json`      | Fix agent commands and model IDs                           |
| `.review-loop/config.json` | New — initial working config (gitignored)                  |
| `progress-log.ts`          | New — `ProgressLog` interface                              |
| `loop-controller.ts`       | Add `log` to `ReviewLoopDeps`, emit progress at each stage |
| `cli.ts`                   | Wire `console.log`-backed `ProgressLog` into deps          |

## Out of Scope

- Changes to ACP client or session bootstrap
- Resume-run logic changes
- Summary format changes
- Test coverage for logging output
