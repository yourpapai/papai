# Workflow hand-off — the two `env:` forwarding lines a maintainer must add by hand

This change documents two new repository variables — `AGENT_EFFORT` (the shared
tier) and `AGENT_EFFORT_PROPOSE` (the per-profile override for drafting) — but
the pipeline that produced it cannot apply the workflow edit itself: a push from
the agent's token may not create or update a file under `.github/workflows/`,
and the refusal discards the whole commit. Until these two lines are added, the
variables are simply absent from the job env and behaviour stays at today's
default; nothing half-applies.

## What to apply

In `.github/workflows/agent-pipeline.yml`, inside the `agent` job's pipeline
step `env:` block, immediately below the existing pair (lines 529–530), add the
two marked lines at the same 10-space indentation:

```text
          # Per-profile model and effort. The light model reaches the read-only
          # phases and `small_model` only; the effort tiers are whatever the
          # configured model offers, and are refused by OpenCode if it does not.
          LLM_MODEL_LIGHT: ${{ vars.LLM_MODEL_LIGHT }}
          AGENT_EFFORT_PLAN: ${{ vars.AGENT_EFFORT_PLAN }}
          AGENT_EFFORT_BUILD: ${{ vars.AGENT_EFFORT_BUILD }}
          AGENT_EFFORT: ${{ vars.AGENT_EFFORT }}
          AGENT_EFFORT_PROPOSE: ${{ vars.AGENT_EFFORT_PROPOSE }}
```

The six non-marked lines above are the file's own content, quoted verbatim —
indentation included — as the siting anchor (verified against the file at lines
525–530 at the time of writing).

## After applying

Remove the `AGENT_EFFORT` / `AGENT_EFFORT_PROPOSE` entries from
`DELIBERATELY_ABSENT` in `tests/opencode-agent/workflow.test.ts` (added with
this change, with the reason recorded there). That test enforces that every
knob the README documents is forwarded; once the forwarding lands, the entries
stop being true and the test should hold the workflow to it like every other
knob's.
