<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { untrack } from 'svelte'

  import { fetchAdminCodingGuardrails, postAdminCodingGuardrails } from '../../admin-fetchers.js'
  import type { AdminCodingGuardrailsResponse } from '../../fetcher-schemas-coding-guardrails.js'
  import Btn from '../../../shared/ui/Btn.svelte'
  import IconButton from '../../../shared/ui/IconButton.svelte'
  import Input from '../../../shared/ui/Input.svelte'
  import PageHeader from '../../../shared/ui/PageHeader.svelte'

  let data: AdminCodingGuardrailsResponse | null = $state(null)
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)

  let draftAllowedAgents: string[] = $state(['claude', 'codex', 'opencode'])
  let draftWhoMayUse: 'members' | 'allowlist' = $state('members')
  let draftAllowlist: string = $state('')
  let draftForceSharedKey: boolean = $state(false)
  let draftProvider: string = $state('anthropic')
  let draftApiKey: string = $state('')
  let draftBaseUrl: string = $state('')
  let replacingKey: boolean = $state(false)

  const ALL_AGENTS = ['claude', 'codex', 'opencode'] as const
  const ALL_PROVIDERS = ['anthropic', 'openai', 'openai-compatible'] as const

  async function load(): Promise<void> {
    error = null
    loading = true
    try {
      const next = await fetchAdminCodingGuardrails()
      data = next
      draftAllowedAgents = [...next.guardrails.allowedAgents]
      draftWhoMayUse = Array.isArray(next.guardrails.whoMayUse) ? 'allowlist' : 'members'
      draftAllowlist = Array.isArray(next.guardrails.whoMayUse) ? next.guardrails.whoMayUse.join('\n') : ''
      draftForceSharedKey = next.guardrails.forceSharedKey
      draftProvider = 'anthropic'
      draftApiKey = ''
      draftBaseUrl = ''
      replacingKey = false
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  function toggleAgent(agent: string): void {
    if (draftAllowedAgents.includes(agent)) {
      draftAllowedAgents = draftAllowedAgents.filter((a) => a !== agent)
    } else {
      draftAllowedAgents = [...draftAllowedAgents, agent]
    }
  }

  async function savePolicy(): Promise<void> {
    error = null
    status = null
    loading = true
    try {
      const whoMayUse: string | string[] =
        draftWhoMayUse === 'members'
          ? 'members'
          : draftAllowlist
              .split('\n')
              .map((s) => s.trim())
              .filter((s) => s.length > 0)
      await postAdminCodingGuardrails({
        kind: 'policy',
        guardrails: { allowedAgents: draftAllowedAgents, whoMayUse, forceSharedKey: draftForceSharedKey },
      })
      await load()
      status = 'Policy saved.'
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function saveSharedKey(): Promise<void> {
    error = null
    status = null
    loading = true
    try {
      const base_url = draftBaseUrl.trim()
      await postAdminCodingGuardrails({
        kind: 'shared-key',
        provider: draftProvider,
        api_key: draftApiKey,
        ...(base_url.length > 0 ? { base_url } : {}),
      })
      await load()
      status = 'Shared key saved.'
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function clearSharedKey(): Promise<void> {
    error = null
    status = null
    loading = true
    try {
      await postAdminCodingGuardrails({ kind: 'shared-key-clear' })
      await load()
      status = 'Shared key cleared.'
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  $effect(() => {
    untrack(() => {
      void load()
    })
  })
</script>

<section id="coding-guardrails" class="settings-section">
  <PageHeader eyebrow="Admin · Coding sessions" title="Operator guardrails">
    {#snippet action()}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load()} testid="guardrails-refresh" />
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  {#if data !== null}
    <div class="guardrails-section">
      <h3 class="guardrails-heading">Allowed agents</h3>
      <div class="guardrails-agents" data-testid="guardrails-agents">
        {#each ALL_AGENTS as agent (agent)}
          <label class="guardrails-checkbox">
            <input
              type="checkbox"
              data-testid={`guardrails-agent-${agent}`}
              checked={draftAllowedAgents.includes(agent)}
              disabled={loading}
              onchange={() => toggleAgent(agent)} />
            {agent}
          </label>
        {/each}
      </div>

      <h3 class="guardrails-heading">Who may use coding sessions</h3>
      <div class="guardrails-who">
        <label class="guardrails-radio">
          <input
            type="radio"
            name="who-may-use"
            value="members"
            checked={draftWhoMayUse === 'members'}
            disabled={loading}
            onchange={() => {
              draftWhoMayUse = 'members'
            }} />
          All group members
        </label>
        <label class="guardrails-radio">
          <input
            type="radio"
            name="who-may-use"
            value="allowlist"
            checked={draftWhoMayUse === 'allowlist'}
            disabled={loading}
            onchange={() => {
              draftWhoMayUse = 'allowlist'
            }} />
          Specific user IDs (allowlist)
        </label>
        {#if draftWhoMayUse === 'allowlist'}
          <textarea
            data-testid="guardrails-allowlist"
            class="guardrails-allowlist"
            placeholder="One user ID per line"
            value={draftAllowlist}
            disabled={loading}
            oninput={(e) => {
              draftAllowlist = (e.currentTarget as HTMLTextAreaElement).value
            }}></textarea>
        {/if}
      </div>

      <h3 class="guardrails-heading">Force shared key</h3>
      <label class="guardrails-checkbox">
        <input
          type="checkbox"
          data-testid="guardrails-force-shared-key"
          checked={draftForceSharedKey}
          disabled={loading}
          onchange={() => {
            draftForceSharedKey = !draftForceSharedKey
          }} />
        Force all users to use the operator shared key (ignore user-configured keys)
      </label>

      <div class="guardrails-save">
        <Btn
          variant="primary"
          size="sm"
          testid="guardrails-save-policy"
          disabled={loading}
          onClick={() => void savePolicy()}>
          {#snippet children()}{loading ? 'Saving…' : 'Save policy'}{/snippet}
        </Btn>
      </div>

      <h3 class="guardrails-heading">Operator shared key</h3>
      {#if data.sharedKeySet && !replacingKey}
        <p class="guardrails-key-set" data-testid="guardrails-key-set">Key set. Use Replace to update it.</p>
        <div class="guardrails-key-actions">
          <Btn
            variant="secondary"
            size="sm"
            testid="guardrails-replace-key"
            disabled={loading}
            onClick={() => {
              replacingKey = true
            }}>
            {#snippet children()}Replace{/snippet}
          </Btn>
          <Btn
            variant="ghost"
            size="sm"
            testid="guardrails-clear-key"
            disabled={loading}
            onClick={() => void clearSharedKey()}>
            {#snippet children()}Clear{/snippet}
          </Btn>
        </div>
      {:else}
        <div class="guardrails-key-fields">
          <label>
            Provider
            <select
              data-testid="guardrails-key-provider"
              value={draftProvider}
              disabled={loading}
              onchange={(e) => {
                draftProvider = (e.currentTarget as HTMLSelectElement).value
              }}>
              {#each ALL_PROVIDERS as p (p)}
                <option value={p}>{p}</option>
              {/each}
            </select>
          </label>
          <Input
            type="password"
            value={draftApiKey}
            placeholder="API key"
            onInput={(v) => {
              draftApiKey = v
            }}
            testid="guardrails-key-input" />
          <Input
            type="text"
            value={draftBaseUrl}
            placeholder="Base URL (optional)"
            onInput={(v) => {
              draftBaseUrl = v
            }}
            testid="guardrails-base-url-input" />
          <div class="guardrails-key-actions">
            <Btn
              variant="primary"
              size="sm"
              testid="guardrails-save-key"
              disabled={loading || draftApiKey.trim().length === 0}
              onClick={() => void saveSharedKey()}>
              {#snippet children()}{loading ? 'Saving…' : 'Save key'}{/snippet}
            </Btn>
            {#if data.sharedKeySet}
              <Btn
                variant="ghost"
                size="sm"
                testid="guardrails-cancel-replace"
                disabled={loading}
                onClick={() => {
                  replacingKey = false
                }}>
                {#snippet children()}Cancel{/snippet}
              </Btn>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  {:else if loading}
    <p class="placeholder">Loading…</p>
  {/if}
</section>

<style>
  .guardrails-section {
    display: grid;
    gap: 16px;
  }
  .guardrails-heading {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--fg2);
    margin: 0;
  }
  .guardrails-agents,
  .guardrails-who {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .guardrails-checkbox,
  .guardrails-radio {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    cursor: pointer;
  }
  .guardrails-allowlist {
    width: 100%;
    min-height: 80px;
    padding: 8px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--fg);
    font-size: 13px;
    font-family: var(--font-mono);
    resize: vertical;
  }
  .guardrails-save {
    display: flex;
    justify-content: flex-start;
  }
  .guardrails-key-set {
    font-size: 14px;
    color: var(--fg2);
    margin: 0;
  }
  .guardrails-key-fields {
    display: grid;
    gap: 8px;
  }
  .guardrails-key-actions {
    display: flex;
    gap: 8px;
  }
</style>
