// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { McpServers } from '../../opencode-agent/src/mcp-servers.js'
import {
  buildOpencodeConfig,
  modelRef,
  NO_MODEL_PROFILES,
  opencodeConfigEnv,
  PROPOSE_PERMISSION,
  READ_ONLY_PERMISSION,
  WRITE_PERMISSION,
} from '../../opencode-agent/src/openai-config.js'
import type { ModelProfiles, OpenAiSettings } from '../../opencode-agent/src/openai-config.js'
import { parseModelRef } from '../../opencode-agent/src/sdk-contract.js'

/**
 * Design D8 — the capability profile for artefact-writing turns.
 *
 * The drafter (PLANNING under the OpenSpec rework) gains `edit` on top of the
 * read-only set, deny-by-default, with the diff guard's `outsidePrefix`
 * confining what survives staging to `openspec/changes/<name>/`. No `bash`:
 * composing artefacts is not running commands. These tests pin the profile's
 * shape and its registration in the built config.
 */

const settings: OpenAiSettings = {
  apiKey: 'sk-test',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-5',
  provider: 'openai',
}

/**
 * The emitted config as it stood before `LLM_PROVIDER` existed, recorded from
 * the builder rather than written by hand.
 *
 * The default has to be *exactly* today or the change is not additive, and only
 * a whole-document comparison says so — asserting the fields the change touches
 * would pass while a permission profile quietly moved.
 */
const PRE_CHANGE_CONFIG =
  '{"$schema":"https://opencode.ai/config.json","provider":{"openai":{"npm":"@ai-sdk/openai-compatible","name":"OpenAI-compatible","options":{"apiKey":"sk-test","baseURL":"https://api.openai.com/v1"},"models":{"gpt-5":{"name":"gpt-5"}}}},"model":"openai/gpt-5","permission":{"*":"deny","read":"allow","grep":"allow","glob":"allow","list":"allow","todowrite":"allow"},"agent":{"plan":{"permission":{"*":"deny","read":"allow","grep":"allow","glob":"allow","list":"allow","todowrite":"allow"}},"propose":{"permission":{"*":"deny","read":"allow","grep":"allow","glob":"allow","list":"allow","todowrite":"allow","edit":"allow"}},"build":{"permission":{"*":"deny","read":"allow","grep":"allow","glob":"allow","list":"allow","todowrite":"allow","edit":"allow","bash":"allow","external_directory":"allow"}}}}'

/**
 * That same document as it stands today: unchanged apart from `setCacheKey`.
 *
 * The one field a later change added unconditionally, because a provider that
 * ignores it is unaffected and it needs no knob of its own. Spliced as **text**
 * rather than by parsing and re-serialising, so every "an unset variable changes
 * nothing" assertion stays a byte comparison against the recorded original — a
 * round-trip through `JSON.parse` would quietly forgive a reordered key.
 */
const BASELINE_CONFIG = PRE_CHANGE_CONFIG.replace(
  '"baseURL":"https://api.openai.com/v1"',
  '"baseURL":"https://api.openai.com/v1","setCacheKey":true',
)

describe('PROPOSE_PERMISSION (D8)', () => {
  it('is deny-by-default', () => {
    expect(PROPOSE_PERMISSION['*']).toBe('deny')
  })

  it('grants edit on top of the read-only set', () => {
    expect(PROPOSE_PERMISSION['edit']).toBe('allow')
    expect(PROPOSE_PERMISSION['read']).toBe('allow')
    expect(PROPOSE_PERMISSION['grep']).toBe('allow')
  })

  it('does not grant bash — composing artefacts is not running commands', () => {
    expect(PROPOSE_PERMISSION['bash']).toBeUndefined()
  })

  it('is narrower than WRITE_PERMISSION (no bash, no external_directory)', () => {
    expect(WRITE_PERMISSION['bash']).toBe('allow')
    expect(WRITE_PERMISSION['external_directory']).toBe('allow')
    expect(PROPOSE_PERMISSION['bash']).toBeUndefined()
    expect(PROPOSE_PERMISSION['external_directory']).toBeUndefined()
  })
})

describe('buildOpencodeConfig · propose agent registration', () => {
  it('registers a propose agent with PROPOSE_PERMISSION', () => {
    const config = buildOpencodeConfig(settings)
    expect(config.agent?.['propose']?.permission).toEqual(PROPOSE_PERMISSION)
  })

  it('keeps plan read-only and build write-capable alongside it', () => {
    const config = buildOpencodeConfig(settings)
    expect(config.agent?.['plan']?.permission).toEqual(READ_ONLY_PERMISSION)
    expect(config.agent?.['build']?.permission).toEqual(WRITE_PERMISSION)
  })

  it('pins the model reference the SDK and `opencode run` expect', () => {
    const config = buildOpencodeConfig(settings)
    expect(config.model).toBe(modelRef(settings))
    expect(config.provider?.[settings.provider]?.models?.[settings.model]?.name).toBe(settings.model)
  })
})

/**
 * The provider id is a **catalogue key**, and the emitted config has to key by
 * the configured one for the lookup to reach a real row.
 *
 * OpenCode merges this provider over its models.dev-derived database under this
 * id, so keying by a hardcoded `openai` while the endpoint serves something else
 * is what left every non-OpenAI model on `limit.context: 0` — with
 * auto-compaction switched off, since `isOverflow` returns `false` at zero.
 */
describe('buildOpencodeConfig · catalogue provider id', () => {
  const borrowed: OpenAiSettings = {
    ...settings,
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
  }

  it('emits `<provider>/<model>` as the reference both execution paths read', () => {
    expect(modelRef(borrowed)).toBe('anthropic/claude-sonnet-4-6')
    expect(modelRef(settings)).toBe('openai/gpt-5')
  })

  it('round-trips a model id that itself contains slashes', () => {
    const nested: OpenAiSettings = {
      ...settings,
      provider: 'openrouter',
      model: 'anthropic/claude-3.5',
    }

    expect(parseModelRef(modelRef(nested))).toEqual({
      providerID: 'openrouter',
      modelID: 'anthropic/claude-3.5',
    })
  })

  it('keys the provider block by the configured id', () => {
    const config = buildOpencodeConfig(borrowed)

    expect(config.provider).toHaveProperty('anthropic')
    // And only that one — a leftover `openai` block would be a second row for
    // OpenCode to resolve against.
    expect(config.provider).not.toHaveProperty('openai')
    expect(config.model).toBe('anthropic/claude-sonnet-4-6')
    expect(config.provider?.['anthropic']?.models?.['claude-sonnet-4-6']?.name).toBe('claude-sonnet-4-6')
  })

  it('keeps the transport and the endpoint, whatever row is borrowed', () => {
    // The npm package is pinned ahead of the borrowed row's own in OpenCode's
    // resolution order, so this stays an OpenAI-compatible request through the
    // proxy — borrowing metadata must never mean loading another SDK package.
    const provider = buildOpencodeConfig(borrowed).provider?.['anthropic']

    expect(provider?.npm).toBe('@ai-sdk/openai-compatible')
    expect(provider?.options?.apiKey).toBe(borrowed.apiKey)
    expect(provider?.options?.baseURL).toBe(borrowed.baseUrl)
  })

  it('leaves the three permission profiles untouched by the id', () => {
    const config = buildOpencodeConfig(borrowed)

    expect(config.permission).toEqual(READ_ONLY_PERMISSION)
    expect(config.agent?.['plan']?.permission).toEqual(READ_ONLY_PERMISSION)
    expect(config.agent?.['propose']?.permission).toEqual(PROPOSE_PERMISSION)
    expect(config.agent?.['build']?.permission).toEqual(WRITE_PERMISSION)
  })

  it('is the baseline config when the id is the default', () => {
    // D2 — an unset `LLM_PROVIDER` must not move anything, so this pins the
    // whole emitted document rather than the fields the change touches.
    expect(JSON.stringify(buildOpencodeConfig(settings))).toBe(BASELINE_CONFIG)
  })
})

/**
 * The splice: resolved facts ride on the model entry, which is the only place
 * OpenCode reads them from.
 */
describe('buildOpencodeConfig · model facts', () => {
  const modelEntry = (s: OpenAiSettings): Record<string, unknown> | undefined =>
    buildOpencodeConfig(s).provider?.[s.provider]?.models?.[s.model]

  it('carries the resolved limit and capabilities onto the model entry', () => {
    const entry = modelEntry({
      ...settings,
      facts: {
        limit: { context: 200_000, output: 64_000 },
        reasoning: true,
        tool_call: true,
      },
    })

    expect(entry).toEqual({
      name: 'gpt-5',
      limit: { context: 200_000, output: 64_000 },
      reasoning: true,
      tool_call: true,
    })
  })

  it('emits nothing but the name when nothing was resolved', () => {
    // Not `limit: { context: 0 }`: a written zero pins the value that makes
    // `isOverflow` return `false`, where an absent key leaves OpenCode's own
    // catalogue merge free to answer.
    expect(modelEntry({ ...settings, facts: {} })).toEqual({ name: 'gpt-5' })
    expect(modelEntry(settings)).toEqual({ name: 'gpt-5' })
  })

  it('reaches the subprocess config too, so both execution paths agree', () => {
    const withFacts: OpenAiSettings = {
      ...settings,
      facts: { limit: { context: 128_000, output: 8_192 } },
    }
    const inlined = opencodeConfigEnv(withFacts)['OPENCODE_CONFIG_CONTENT']

    expect(inlined).toBe(JSON.stringify(buildOpencodeConfig(withFacts)))
  })

  it('leaves the default config at the baseline when no facts are resolved', () => {
    expect(JSON.stringify(buildOpencodeConfig({ ...settings, facts: {} }))).toBe(BASELINE_CONFIG)
  })
})

/**
 * Per-profile model and effort (D1/D2/D3/D5).
 *
 * Configured on `agent.<name>` rather than per call, and that is not a style
 * choice: the pinned SDK's prompt body has no `variant` field at all, and the
 * review loop shells out to `opencode run` with no `--agent`, resolving to the
 * primary agent — so a per-call setting could never reach it.
 */
describe('buildOpencodeConfig · per-profile model and effort', () => {
  const withProfiles = (profiles: ModelProfiles): OpenAiSettings => ({
    ...settings,
    profiles,
  })

  it('points only the read-only profile and small_model at the light model (D2)', () => {
    const config = buildOpencodeConfig(withProfiles({ ...NO_MODEL_PROFILES, light: 'gpt-5-mini' }))

    expect(config.agent?.['plan']?.model).toBe('openai/gpt-5-mini')
    expect(config.small_model).toBe('openai/gpt-5-mini')
    // Drafting a spec and writing code are not the cheap half.
    expect(config.agent?.['propose']?.model).toBeUndefined()
    expect(config.agent?.['build']?.model).toBeUndefined()
    expect(config.model).toBe('openai/gpt-5')
  })

  it('leaves the model and small_model alone when no light model is named', () => {
    const config = buildOpencodeConfig(withProfiles(NO_MODEL_PROFILES))

    expect(config.agent?.['plan']?.model).toBeUndefined()
    expect(config.small_model).toBeUndefined()
  })

  it('emits a variant per profile only when that tier resolves (D7)', () => {
    const config = buildOpencodeConfig(
      withProfiles({ light: null, planEffort: 'low', proposeEffort: 'high', buildEffort: 'xhigh' }),
    )

    expect(config.agent?.['plan']?.['variant']).toBe('low')
    // A "shared" variable that silently skipped a profile would be the wrong
    // knob: the drafting turns get a tier too (D7).
    expect(config.agent?.['propose']?.['variant']).toBe('high')
    expect(config.agent?.['build']?.['variant']).toBe('xhigh')
  })

  it('emits no variant key anywhere when no tier resolves', () => {
    const config = buildOpencodeConfig(withProfiles(NO_MODEL_PROFILES))

    expect(config.agent?.['plan']?.['variant']).toBeUndefined()
    expect(config.agent?.['propose']?.['variant']).toBeUndefined()
    expect(config.agent?.['build']?.['variant']).toBeUndefined()
    // "Anywhere", not just the three profiles — the strongest form of the
    // additive guarantee is the whole document, unchanged to the byte.
    expect(JSON.stringify(config)).toBe(BASELINE_CONFIG)
  })

  it('still emits the tiers under a reasoning:false catalogue row — the gate is OpenCode’s', () => {
    // The pre-existing gate that empties the effort variants on a
    // `reasoning: false` row lives in OpenCode's transform, past this builder:
    // the tier resolves and is emitted verbatim, and this pipeline never
    // strips it here. Duplicating the gate would desynchronize the two the
    // day OpenCode's rule moves (design Non-Goals).
    const gated: OpenAiSettings = {
      ...settings,
      profiles: { light: null, planEffort: 'low', proposeEffort: 'high', buildEffort: 'xhigh' },
      facts: { reasoning: false },
    }
    const config = buildOpencodeConfig(gated)

    expect(config.provider?.[gated.provider]?.models?.[gated.model]?.reasoning).toBe(false)
    expect(config.agent?.['plan']?.['variant']).toBe('low')
    expect(config.agent?.['propose']?.['variant']).toBe('high')
    expect(config.agent?.['build']?.['variant']).toBe('xhigh')
  })

  it('keeps the three permission profiles byte-identical either way', () => {
    const configured = buildOpencodeConfig(
      withProfiles({
        light: 'gpt-5-mini',
        planEffort: 'low',
        proposeEffort: null,
        buildEffort: 'high',
      }),
    )

    expect(configured.permission).toEqual(READ_ONLY_PERMISSION)
    expect(configured.agent?.['plan']?.permission).toEqual(READ_ONLY_PERMISSION)
    expect(configured.agent?.['propose']?.permission).toEqual(PROPOSE_PERMISSION)
    expect(configured.agent?.['build']?.permission).toEqual(WRITE_PERMISSION)
  })

  it('asks the provider for a prompt cache key, unconditionally (D5)', () => {
    // `ProviderTransform` emits `promptCacheKey` for `@ai-sdk/openai-compatible`
    // only when this is `true`; a provider that ignores the field is unaffected,
    // which is why it needs no variable of its own.
    const provider = buildOpencodeConfig(settings).provider?.[settings.provider]

    expect(provider?.options?.setCacheKey).toBe(true)
    expect(provider?.options?.apiKey).toBe(settings.apiKey)
    expect(provider?.options?.baseURL).toBe(settings.baseUrl)
  })

  it('differs from the pre-change config only by setCacheKey when nothing is set (D3)', () => {
    // The one difference, named: everything else in the recorded document is
    // reproduced byte for byte.
    expect(BASELINE_CONFIG).not.toBe(PRE_CHANGE_CONFIG)
    expect(BASELINE_CONFIG.replace(',"setCacheKey":true', '')).toBe(PRE_CHANGE_CONFIG)
    expect(JSON.stringify(buildOpencodeConfig(settings))).toBe(BASELINE_CONFIG)
  })
})

/**
 * MCP servers (the `AGENT_MCP_SERVERS` knob), emitted by the same single
 * builder that serves both execution paths.
 *
 * The grant keys are **generated** from the server names, never hand-keyed: a
 * bare server name is a silent no-op as a permission key, and generation is
 * what dissolves that typo class. `<name>_*` is the wildcard form verified to
 * admit the server's whole toolset, and it lands after the named allows in
 * every map it joins — the resolved rules list is an ordered concatenation and
 * the later rule wins, which is why the allows sit after `"*": "deny"`.
 */
describe('buildOpencodeConfig · MCP servers', () => {
  const servers: McpServers = {
    fetcher: {
      type: 'local',
      command: ['bunx', 'mcp-server-fetch@1.0.0'],
      environment: { FETCH_TIMEOUT: '5000' },
    },
    index: {
      type: 'remote',
      url: 'https://mcp.example.com/sse',
      headers: { Authorization: 'Bearer tok-1234' },
    },
  }
  const withServers: OpenAiSettings = { ...settings, mcpServers: servers }

  it('emits the mcp block, carrying each entry under its name', () => {
    // The remote differs from its declaration by exactly `oauth: false` — the
    // one transformation emission performs (D2, asserted below); the local
    // entry rides through as declared.
    expect(buildOpencodeConfig(withServers).mcp).toEqual({
      fetcher: {
        type: 'local',
        command: ['bunx', 'mcp-server-fetch@1.0.0'],
        environment: { FETCH_TIMEOUT: '5000' },
      },
      index: {
        type: 'remote',
        url: 'https://mcp.example.com/sse',
        headers: { Authorization: 'Bearer tok-1234' },
        oauth: false,
      },
    })
  })

  it('forces oauth: false on every remote, whatever the declaration could have said', () => {
    // D2's emission half. An OAuth remote parks at `needs_auth` for ever in an
    // unattended job; the parse refuses the `oauth` key outright, and this is
    // the same rule on the way out — a maintainer who omitted the field still
    // gets the clean `failed`-with-HTTP-error degradation.
    expect(buildOpencodeConfig(withServers).mcp?.['index']).toMatchObject({
      url: 'https://mcp.example.com/sse',
      oauth: false,
    })
  })

  it('grants "<name>_*": "allow" in plan and build, after their existing allows', () => {
    const config = buildOpencodeConfig(withServers)

    // Exact key order, because the order is the design: allows after
    // `"*": "deny"`, generated MCP keys after the allows.
    expect(Object.keys({ ...config.agent?.['plan']?.permission })).toEqual([
      '*',
      'read',
      'grep',
      'glob',
      'list',
      'todowrite',
      'fetcher_*',
      'index_*',
    ])
    expect(Object.keys({ ...config.agent?.['build']?.permission })).toEqual([
      '*',
      'read',
      'grep',
      'glob',
      'list',
      'todowrite',
      'edit',
      'bash',
      'external_directory',
      'fetcher_*',
      'index_*',
    ])
    const planGrant: Record<string, unknown> = { ...config.agent?.['plan']?.permission }
    const buildGrant: Record<string, unknown> = { ...config.agent?.['build']?.permission }

    expect(planGrant['fetcher_*']).toBe('allow')
    expect(buildGrant['index_*']).toBe('allow')
  })

  it('gives the drafting profile no MCP key (D1)', () => {
    // The `propose` map is deliberately the most confined — read plus edit, no
    // bash — and MCP tools would be its only unconfined egress. Drafting turns
    // compose prose.
    const propose: Record<string, unknown> = { ...buildOpencodeConfig(withServers).agent?.['propose']?.permission }

    expect(propose['fetcher_*']).toBeUndefined()
    expect(propose['index_*']).toBeUndefined()
    expect(Object.keys(propose).some((key) => key.endsWith('_*'))).toBe(false)
  })

  it('carries the generated key in the global default too', () => {
    // The default is what an agent this pipeline does not name inherits — and
    // deny-by-default would otherwise keep every MCP tool invisible there.
    const permission: Record<string, unknown> = { ...buildOpencodeConfig(withServers).permission }

    expect(permission['fetcher_*']).toBe('allow')
    expect(permission['index_*']).toBe('allow')
  })

  it('emits "allow" only — "ask" would deadlock an unattended job', () => {
    const config = buildOpencodeConfig(withServers)
    // Spreads, not `?? {}`: a spread of an absent map is an empty object with
    // no conditional in sight, and every entry the maps do carry lands here.
    const maps = [
      { ...config.permission },
      { ...config.agent?.['plan']?.permission },
      { ...config.agent?.['build']?.permission },
    ]
    const grantValues = maps
      .flatMap((map) => Object.entries(map))
      .filter(([key]) => key.endsWith('_*'))
      .map(([, value]) => value)

    expect(grantValues.length).toBeGreaterThan(0)
    expect([...new Set(grantValues)]).toEqual(['allow'])
  })

  it('reaches the subprocess config identically, so both paths agree', () => {
    const inlined = opencodeConfigEnv(withServers)['OPENCODE_CONFIG_CONTENT']

    expect(inlined).toBe(JSON.stringify(buildOpencodeConfig(withServers)))
    const parsed: unknown = JSON.parse(String(inlined))
    expect(parsed).toMatchObject({ mcp: { index: { oauth: false } } })
  })

  it('is byte-identical to the baseline with no servers declared', () => {
    // Both absences: the field unset, and the empty map `AGENT_MCP_SERVERS={}`
    // parses to. An empty `mcp` block or a stray grant key would break the
    // additive guarantee the same way a moved permission did.
    expect(JSON.stringify(buildOpencodeConfig(settings))).toBe(BASELINE_CONFIG)
    expect(JSON.stringify(buildOpencodeConfig({ ...settings, mcpServers: {} }))).toBe(BASELINE_CONFIG)
  })
})
