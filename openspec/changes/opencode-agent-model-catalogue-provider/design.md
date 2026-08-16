<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Catalogue provider id for the agent's model

## Context

See `proposal.md` — Why. The mechanism worth restating precisely, because every
decision below turns on it (`packages/opencode/src/provider/provider.ts`,
v1.18.12, lines 1424-1502):

```
database["<providerID>"]  ←  models.dev catalogue for that provider
        │
        └─ config provider merged OVER it:
             parsed.models   = existing.models          (the whole catalogue)
             existingModel   = parsed.models[modelID]   (lookup by LLM_MODEL)
             limit.context   = cfg ?? existingModel?.limit?.context ?? 0
             reasoning       = cfg ?? existingModel?.…  ?? false
             api.npm         = model.provider?.npm ?? provider.npm ?? …
```

The provider id is a **catalogue key**, and only incidentally the name of a
wire protocol. The pipeline has been using it as the latter.

Constraints this design has to respect:

- The pinned SDK is `@opencode-ai/sdk@1.18.12`. Its `ProviderConfig` accepts
  `models.<id>.{limit,reasoning,temperature,tool_call,attachment,options,
  headers,cost}` and `options.setCacheKey`; it has **no** `compaction` block
  and **no** `agent.variant`. Whether the pin moves is an open question in the
  workspace, so nothing here may depend on it.
- The provider key never reaches OpenCode: `provider-proxy.ts` configures a
  loopback base URL and `PLACEHOLDER_API_KEY`, and swaps the real
  `Authorization` in on the way out (S3-9). Any change to provider identity has
  to leave that arrangement byte-identical.
- `openai-config.ts` is the single definition serving both execution paths —
  `createOpencodeServer({ config })` and `OPENCODE_CONFIG_CONTENT` for the
  review loop's `opencode run` subprocesses. The two must not drift.

## Goals / Non-Goals

**Goals:**

- A configuration in which `limit.context` is non-zero, so auto-compaction is
  reachable at all.
- A configuration in which `capabilities.reasoning` can be true, so the effort
  variants a later change selects from exist.
- One new knob, defaulting to today's behavior exactly.

**Non-Goals:**

- Deciding *which* effort or model a phase uses — that is
  `opencode-agent-per-phase-model-params`.
- Covering models absent from every catalogue — that is
  `opencode-agent-model-metadata-fallback`.
- Any change to how the key is held or proxied.

## Decisions

### D1 — A catalogue id separate from the transport, not a second transport

`LLM_PROVIDER` names the models.dev provider to resolve metadata under.
`provider.<id>.npm` stays pinned to `@ai-sdk/openai-compatible` in the emitted
config, and the merge order (`model.provider?.npm ?? provider.npm ??
existingModel?.api.npm ?? …`) puts our explicit `npm` **ahead** of whatever the
catalogue entry carries. So `LLM_PROVIDER=anthropic` borrows Anthropic's
catalogue row without ever loading `@ai-sdk/anthropic`.

*Alternative considered — let the operator set the npm package too.* Rejected:
it turns one knob into a matrix, and the whole premise of `OpenAiSettings` is
that one OpenAI-compatible endpoint covers every provider worth pointing at. It
would also break the proxy, which forwards OpenAI-shaped requests only.

*Alternative considered — infer the provider from the model id* (`claude-*` →
`anthropic`, `qwen*` → `alibaba`, …). Rejected: it is the same
prefix-table guessing that `src/model-context.ts` demonstrates the failure mode
of, and it silently picks a wrong row instead of leaving one unset.

### D2 — The default is `openai`, so nothing moves without being asked to

Unset `LLM_PROVIDER` produces byte-identical config to today. That keeps the
change reviewable against a recorded fixture and means a repository already
running `gpt-5` against OpenAI sees no diff at all.

### D3 — Validated at load, like every other knob

`config-values.ts` states the rule this workspace follows: rejecting malformed
values only closes "not a value", never "a value that cannot work". A provider
id is a bare catalogue key, so the accepted shape is narrow — lowercase
alphanumerics with `-`/`_`/`.`, bounded length, no slash (a slash would split
`modelRef` at the wrong place). Anything else is a `ConfigError` naming
`LLM_PROVIDER`, in the loader, rather than a metadata miss discovered as a
dead turn twenty minutes in.

### D4 — `modelRef` stays the one place the reference is spelled

`modelRef` already exists precisely so the SDK path and the subprocess path
cannot disagree; it becomes `${settings.provider}/${settings.model}`.
`parseModelRef` splits on the **first** slash and keeps the remainder, which is
why D3 forbids a slash in the provider id and why model ids containing slashes
keep working.

## Risks / Trade-offs

- **A real provider id activates OpenCode's env auth loop.** After the config
  merge, `provider.ts` iterates the database and, for any provider whose `env`
  names a variable present in the environment, merges a key with
  `source: "env"`. Setting `LLM_PROVIDER=anthropic` inherits
  `env: ["ANTHROPIC_API_KEY"]` from the catalogue row. → Mitigation:
  `secrets.ts` already scrubs the child environment and the pipeline sets only
  `LLM_*`, so no such variable is present; the manual verification step asserts
  the emitted request still carries the proxy's swapped-in header. Explicitly
  setting `env: []` on the config provider is the fallback if it ever does.
- **Catalogue metadata can be wrong for a gateway.** A gateway may serve a
  smaller context window than the upstream model's catalogue row claims, so
  compaction would trigger too late. → Mitigation: this is strictly better than
  `0` (never), and the follow-up change adds explicit overrides that win over
  the catalogue.
- **A wrong-but-valid provider id resolves to a wrong row** rather than to
  nothing, and nothing detects it. → Mitigation: log the resolved
  `limit.context`/`reasoning` at `debug` on boot so a run's own log says which
  row it got; a zero context window is then visible rather than inferred.
- **Trade-off: one more required decision for an operator.** Accepted — it is
  optional, defaults to today, and the alternative is guessing (D1).

## Migration Plan

Additive and defaulted; no state, no persisted format, no in-flight issue is
affected. Rollback is unsetting the variable.

## Open Questions

None that would change the specs, the approach or the task breakdown. Whether
the SDK pin moves is tracked in `opencode-agent/ROADMAP.md` and is deliberately
not a dependency of this change.
