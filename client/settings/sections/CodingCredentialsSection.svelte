<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { untrack } from 'svelte'

  import Confirm from '../../shared/Confirm.svelte'
  import Btn from '../../shared/ui/Btn.svelte'
  import ErrorState from '../../shared/ui/ErrorState.svelte'
  import IconButton from '../../shared/ui/IconButton.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import Secret from '../../shared/ui/Secret.svelte'
  import SettingsFieldShell from '../components/SettingsFieldShell.svelte'
  import type { CodingCredentialField, CodingCredentialsResponse } from '../fetcher-schemas.js'
  import {
    clearCodingCredentials,
    fetchCodingCredentials,
    fetchCodingModels,
    patchCodingCredentials,
  } from '../coding-credentials-fetchers.js'
  import { maskSecret } from '../lib/mask-secret.js'

  // Client-side compatibility map (mirrors src/coding-credentials/types.ts `compatible`)
  function compatibleProviders(agent: string, allProviders: readonly string[]): string[] {
    if (agent === 'claude') return allProviders.filter((p) => p === 'anthropic')
    if (agent === 'codex') return allProviders.filter((p) => p === 'openai' || p === 'openai-compatible')
    if (agent === 'opencode')
      return allProviders.filter((p) => p === 'anthropic' || p === 'openai' || p === 'openai-compatible')
    return [...allProviders]
  }

  interface Props {
    contextId: string
  }
  let { contextId }: Props = $props()

  let data: CodingCredentialsResponse | null = $state(null)
  let modelOptions: { value: string; label: string }[] = $state([])
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)
  let saving = $state(false)
  let drafts: Record<string, string> = $state({})
  let replacing: Record<string, boolean> = $state({})
  let loadedContextId: string | null = $state(null)

  const currentData = $derived(loadedContextId === contextId ? data : null)
  const fields = $derived(currentData?.fields ?? [])
  const unreadableError = $derived(currentData?.unreadable === true ? currentData.error : null)

  // Whole-record save is meaningful only when at least one field's draft differs from its
  // stored value. A sensitive field's editor baseline is '' (untouched secret).
  const formDirty = $derived(fields.some((f) => (drafts[f.key] ?? '') !== (f.sensitive ? '' : f.value)))

  // Track current agent draft for filtering provider options
  const agentField = $derived(fields.find((f) => f.key === 'agent'))
  const currentAgent = $derived(drafts['agent'] ?? agentField?.value ?? '')

  // Track current provider draft to surface base-URL-required hint for openai-compatible
  const providerField = $derived(fields.find((f) => f.key === 'provider'))
  const currentProvider = $derived(drafts['provider'] ?? providerField?.value ?? '')
  // Saved (server-side) provider — draft may differ before a Save. Model list is only
  // valid for the stored provider; clear it when the user has switched but not saved.
  const storedProvider = $derived(providerField?.value ?? '')
  const isOpenAiCompatible = $derived(currentProvider === 'openai-compatible')

  const authMethodField = $derived(fields.find((f) => f.key === 'auth_method'))
  const currentAuthMethod = $derived(drafts['auth_method'] ?? authMethodField?.value ?? 'api-key')
  const isOauthSubscription = $derived(currentAuthMethod === 'oauth-subscription')

  function fieldHidden(field: CodingCredentialField): boolean {
    if (field.key === 'provider_base_url' && isOauthSubscription) return true
    if (field.key === 'auth_method' && currentProvider !== 'anthropic') return true
    return false
  }
  function labelFor(field: CodingCredentialField): string {
    if (field.key === 'provider_api_key' && isOauthSubscription) return 'OAuth token'
    return field.label
  }

  function selectOptionsFor(field: CodingCredentialField): string[] {
    const opts = field.options ?? []
    if (field.key === 'agent') {
      const allowed = currentData?.allowedAgents
      return allowed !== undefined && allowed.length > 0 ? opts.filter((o) => allowed.includes(o)) : opts
    }
    if (field.key === 'provider' && currentAgent.length > 0) {
      return compatibleProviders(currentAgent, opts)
    }
    return opts
  }

  function initialDrafts(nextFields: CodingCredentialField[]): Record<string, string> {
    return Object.fromEntries(nextFields.map((f) => [f.key, f.sensitive && f.hasValue ? '' : f.value]))
  }
  function displaySecret(value: string): string {
    return value.includes('*') ? maskSecret(value) : '••••••••'
  }
  async function load(id: string): Promise<boolean> {
    error = null
    status = null
    loading = true
    try {
      const next = await fetchCodingCredentials(id)
      if (id !== contextId) return false
      data = next
      loadedContextId = id
      drafts = initialDrafts(next.fields)
      replacing = {}
      return true
    } catch (err) {
      if (id === contextId) error = err instanceof Error ? err.message : String(err)
      return false
    } finally {
      if (id === contextId) loading = false
    }
  }
  function updateDraft(key: string, value: string): void {
    drafts = { ...drafts, [key]: value }
  }
  function replaceSecret(key: string): void {
    replacing = { ...replacing, [key]: true }
    updateDraft(key, '')
  }
  function cancelReplace(key: string): void {
    const { [key]: _, ...rest } = replacing
    replacing = rest
    updateDraft(key, '')
  }
  function editorOpen(field: CodingCredentialField): boolean {
    return !field.sensitive || replacing[field.key] === true || !field.hasValue
  }
  // Selecting a value only updates the local draft — nothing persists until Save.
  // When the agent changes and the current provider is no longer compatible, reset
  // the provider draft to the first compatible option so the whole-record save is
  // always internally consistent (never sends an invalid agent/provider pair).
  function onSelectChange(field: CodingCredentialField, value: string): void {
    updateDraft(field.key, value)
    if (field.key === 'agent') {
      const compatible = compatibleProviders(value, fields.find((f) => f.key === 'provider')?.options ?? [])
      const currentProvider = drafts['provider'] ?? ''
      if (compatible.length > 0 && !compatible.includes(currentProvider)) {
        updateDraft('provider', compatible[0]!)
      }
      updateDraft('model', '')
    }
  }

  // Whole-record save: agent/provider/base-URL are validated together server-side, so
  // persist them in one PATCH. Saving fields individually hits the route's cross-field
  // 422 (e.g. openai-compatible before its base URL) and silently drops the field.
  function collectValues(): Record<string, string> {
    const values: Record<string, string> = {}
    for (const field of fields) {
      // Preserve an untouched secret: omit it so the server keeps the stored value.
      if (field.sensitive && field.hasValue && replacing[field.key] !== true) continue
      values[field.key] = drafts[field.key] ?? ''
    }
    // Submit-time invariants: a hidden field must not carry stale state that the
    // server's merged-state validation would reject (a 422 with no visible field to fix).
    const provider = drafts['provider'] ?? ''
    if (provider !== 'anthropic' && values['auth_method'] === 'oauth-subscription') {
      values['auth_method'] = 'api-key' // oauth-subscription is anthropic-only
    }
    if (values['auth_method'] === 'oauth-subscription') {
      values['provider_base_url'] = '' // oauth uses no base URL; clear any stored one
    }
    return values
  }
  async function saveAll(): Promise<void> {
    if (loading || saving || loadedContextId !== contextId) return
    error = null
    status = null
    saving = true
    try {
      await patchCodingCredentials({ contextId, values: collectValues() })
      const ok = await load(contextId)
      if (ok) status = 'AI provider saved.'
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      saving = false
    }
  }

  let pendingClear = $state(false)
  let clearing = $state(false)
  let clearError = $state<string | null>(null)

  async function confirmClear(): Promise<void> {
    if (clearing || loadedContextId !== contextId) return
    clearError = null
    status = null
    clearing = true
    let ok = false
    try {
      await clearCodingCredentials({ contextId })
      ok = true
    } catch (err) {
      clearError = err instanceof Error ? err.message : String(err)
    } finally {
      clearing = false
    }
    if (ok) {
      pendingClear = false
      const reloaded = await load(contextId)
      if (reloaded) status = 'AI provider credentials cleared.'
    }
  }

  $effect(() => {
    const id = contextId
    untrack(() => {
      void load(id)
    })
  })

  $effect(() => {
    const id = contextId
    const agent = currentAgent
    const hasKey = fields.find((f) => f.key === 'provider_api_key')?.hasValue === true
    const providerDraft = currentProvider
    const savedProvider = storedProvider
    untrack(() => {
      // Clear stale suggestions when the provider draft differs from the saved value
      // (the model list belongs to the stored provider, not the unsaved draft).
      if (!hasKey || agent.length === 0 || providerDraft !== savedProvider) {
        modelOptions = []
        return
      }
      void fetchCodingModels(id, agent)
        .then((r) => {
          if (id === contextId) modelOptions = r.ok ? r.models : []
        })
        .catch(() => {
          if (id === contextId) modelOptions = []
        })
    })
  })

</script>

<section id="coding-credentials" class="settings-section">
  <PageHeader eyebrow="Coding sessions" title="AI provider">
    {#snippet action()}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load(contextId)} testid="coding-refresh" />
    {/snippet}
  </PageHeader>

  {#if currentData !== null && error !== null}<p class="status-error" role="alert">{error}</p>{/if}
  {#if status !== null}<p class="status-success" role="status">{status}</p>{/if}

  {#if currentData === null && loading}
    <p class="placeholder">Loading…</p>
  {:else if currentData === null && error !== null}
    <ErrorState message={error} onRetry={() => void load(contextId)} />
  {:else if currentData !== null}
    {#if unreadableError !== null}
      <p class="status-error" role="alert">Stored credentials are unreadable. Re-enter your key to repair this context.</p>
    {/if}
    {#if !currentData.complete}
      <p class="placeholder">
        Coding sessions need your model-provider API key. Enter it below — it is encrypted and used only to run your sessions.
      </p>
    {/if}

    <div class="settings-byok-fields">
      {#each fields as field (field.key)}
        {#if !fieldHidden(field)}
          {@const effectiveRequired = field.required || (field.key === 'provider_base_url' && isOpenAiCompatible)}
          <SettingsFieldShell
            label={labelFor(field)}
            required={effectiveRequired}
            editorOpen={editorOpen(field)}
            testid={`coding-row-${field.key}`}>
            {#snippet head()}
              {#if field.sensitive && field.hasValue && !editorOpen(field)}
                <Secret value={displaySecret(field.value)} />
                <Btn variant="secondary" size="sm" testid={`coding-replace-${field.key}`} onClick={() => replaceSecret(field.key)}>
                  {#snippet children()}Replace{/snippet}
                </Btn>
              {/if}
            {/snippet}
            {#snippet editor()}
              {#if field.control === 'select'}
                <select
                  data-testid={`coding-select-${field.key}`}
                  value={drafts[field.key] ?? ''}
                  disabled={saving || loading}
                  onchange={(e) => onSelectChange(field, (e.currentTarget as HTMLSelectElement).value)}
                  class="coding-select">
                  {#each selectOptionsFor(field) as opt (opt)}
                    <option value={opt}>{opt}</option>
                  {/each}
                </select>
              {:else if field.control === 'combobox'}
                <input
                  list={`coding-models-${field.key}`}
                  data-testid={`coding-combobox-${field.key}`}
                  value={drafts[field.key] ?? ''}
                  placeholder="model id (leave blank for the agent default)"
                  disabled={saving || loading}
                  oninput={(e) => updateDraft(field.key, (e.currentTarget as HTMLInputElement).value)}
                  class="coding-select" />
                <datalist id={`coding-models-${field.key}`}>
                  {#each modelOptions as opt (opt.value)}
                    <option value={opt.value}></option>
                  {/each}
                </datalist>
              {:else}
                <Input
                  type={field.sensitive ? 'password' : 'text'}
                  value={drafts[field.key] ?? ''}
                  placeholder={field.key === 'provider_api_key' && isOauthSubscription
                    ? 'sk-ant-oat01-… (run `claude setup-token`)'
                    : field.sensitive
                      ? 'enter a new value'
                      : field.key === 'provider_base_url' && isOpenAiCompatible
                        ? 'https://your-llm-endpoint/v1 (required)'
                        : ''}
                  onInput={(value) => updateDraft(field.key, value)}
                  testid={`coding-input-${field.key}`} />
                {#if field.sensitive && field.hasValue}
                  <Btn variant="ghost" size="sm" testid={`coding-cancel-${field.key}`} onClick={() => cancelReplace(field.key)}>
                    {#snippet children()}Cancel{/snippet}
                  </Btn>
                {/if}
              {/if}
            {/snippet}
          </SettingsFieldShell>
        {/if}
      {/each}

      <div class="settings-field__actions">
        {#if currentData.configured}
          <Btn
            variant="ghost"
            size="sm"
            testid="coding-credentials-clear"
            disabled={saving || loading || clearing}
            onClick={() => {
              pendingClear = true
              clearError = null
            }}>
            {#snippet children()}{clearing ? 'Clearing…' : 'Clear'}{/snippet}
          </Btn>
        {/if}
        <Btn
          variant="primary"
          size="sm"
          testid="coding-credentials-save"
          disabled={!formDirty || saving || loading || clearing}
          onClick={() => void saveAll()}>
          {#snippet children()}{saving ? 'Saving…' : 'Save'}{/snippet}
        </Btn>
      </div>
    </div>
  {/if}

  <Confirm
    open={pendingClear}
    title="Clear AI provider credentials"
    danger
    busy={clearing}
    confirmLabel="Clear"
    onCancel={() => (pendingClear = false)}
    onConfirm={() => void confirmClear()}>
    {#snippet body()}
      <p>Remove the stored AI provider key, agent, and model for this context? This cannot be undone.</p>
      {#if clearError !== null}<p class="status-error">{clearError}</p>{/if}
    {/snippet}
  </Confirm>
</section>

<style>
  .settings-byok-fields {
    display: grid;
    gap: var(--gap-inline);
  }
  .settings-field__actions {
    display: flex;
    justify-content: flex-end;
  }
  .coding-select {
    flex: 1;
    min-width: 200px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--fg);
    font-size: 14px;
  }
</style>
