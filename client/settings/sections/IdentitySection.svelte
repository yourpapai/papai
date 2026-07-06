<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { IdentityResponse } from '../fetcher-schemas.js'
  import { deleteIdentity, fetchIdentity, putIdentity } from '../fetchers.js'
  import Confirm from '../../shared/Confirm.svelte'
  import Btn from '../../shared/ui/Btn.svelte'
  import EmptyState from '../../shared/ui/EmptyState.svelte'
  import ErrorState from '../../shared/ui/ErrorState.svelte'
  import Field from '../../shared/ui/Field.svelte'
  import IconButton from '../../shared/ui/IconButton.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let data: IdentityResponse | null = $state(null)
  let loadError: string | null = $state(null)
  let loading = $state(false)

  let providerUserId = $state('')
  let providerUserLogin = $state('')
  let displayName = $state('')

  let saving = $state(false)
  let clearing = $state(false)
  let confirmingClear = $state(false)
  let validationError: string | null = $state(null)
  let saveError: string | null = $state(null)
  let clearError: string | null = $state(null)
  let saved = $state(false)

  const providerName = $derived(data?.providerName ?? 'your task provider')
  const headerTitle = $derived(data !== null ? `Identity · ${data.providerName}` : 'Identity')
  const hasMapping = $derived(data?.mapping != null)

  const view = $derived(
    data !== null
      ? 'form'
      : loadError !== null
        ? loadError.includes('no task instance')
          ? 'gated'
          : 'loadError'
        : 'loading',
  )

  function applyMapping(result: IdentityResponse): void {
    data = result
    const m = result.mapping
    providerUserId = m?.providerUserId ?? ''
    providerUserLogin = m?.providerUserLogin ?? ''
    displayName = m?.displayName ?? ''
  }

  async function load(id: string): Promise<void> {
    loadError = null
    saveError = null
    clearError = null
    validationError = null
    saved = false
    data = null
    loading = true
    try {
      const result = await fetchIdentity(id)
      if (id !== contextId) return
      applyMapping(result)
    } catch (err) {
      if (id !== contextId) return
      loadError = err instanceof Error ? err.message : String(err)
    } finally {
      if (id === contextId) loading = false
    }
  }

  // Silent post-mutation refresh: keeps the form visible; a refresh failure is
  // ignored because the mutation itself already succeeded.
  async function refresh(id: string): Promise<void> {
    try {
      const result = await fetchIdentity(id)
      if (id !== contextId) return
      applyMapping(result)
    } catch {
      // ignore
    }
  }

  async function save(): Promise<void> {
    if (saving) return
    saveError = null
    saved = false
    if (providerUserId.trim() === '') {
      validationError = 'Provider user ID is required.'
      return
    }
    validationError = null
    saving = true
    try {
      await putIdentity({ providerUserId, providerUserLogin, displayName, contextId })
      await refresh(contextId)
      saved = true
    } catch (err) {
      saveError = err instanceof Error ? err.message : String(err)
    } finally {
      saving = false
    }
  }

  function openClear(): void {
    clearError = null
    confirmingClear = true
  }

  async function confirmClear(): Promise<void> {
    clearError = null
    clearing = true
    try {
      await deleteIdentity(contextId)
      confirmingClear = false
      await load(contextId)
    } catch (err) {
      clearError = err instanceof Error ? err.message : String(err)
    } finally {
      clearing = false
    }
  }

  $effect(() => {
    void load(contextId)
  })
</script>

<section id="identity" class="settings-section">
  <PageHeader eyebrow="Personal" title={headerTitle}>
    {#snippet action()}
      <IconButton
        label="Refresh"
        glyph="⟳"
        busy={loading}
        onClick={() => void load(contextId)}
        testid="identity-refresh" />
    {/snippet}
  </PageHeader>

  {#if view === 'loading'}
    <p class="placeholder">Loading…</p>
  {:else if view === 'gated'}
    <EmptyState
      title="No task provider configured"
      hint="Assign a task provider to this context before linking your identity."
    >
      {#snippet action()}
        <a class="settings-empty-link" href="#task-provider">Configure task provider →</a>
      {/snippet}
    </EmptyState>
  {:else if view === 'loadError'}
    <ErrorState message={loadError ?? ''} onRetry={() => void load(contextId)} />
  {:else}
    <p class="identity-intro">
      Link your chat account to your {providerName} account so the bot can create and assign tasks as you.
    </p>
    <form
      class="settings-form identity-form"
      onsubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <Field
        label="Provider user ID"
        required
        hint={`Your account ID in ${providerName} — from your tracker profile or user URL.`}
        error={validationError ?? undefined}
      >
        {#snippet children()}
          <Input
            value={providerUserId}
            placeholder="e.g. 42"
            onInput={(v) => (providerUserId = v)}
            testid="identity-user-id" />
        {/snippet}
      </Field>
      <Field label="Provider login" hint={`Your ${providerName} username, if different from the ID.`}>
        {#snippet children()}
          <Input value={providerUserLogin} placeholder="e.g. alice" onInput={(v) => (providerUserLogin = v)} />
        {/snippet}
      </Field>
      <Field label="Display name" hint="Name shown on tasks the bot creates for you.">
        {#snippet children()}
          <Input value={displayName} placeholder="e.g. Alice" onInput={(v) => (displayName = v)} />
        {/snippet}
      </Field>
      <div class="identity-actions">
        <Btn variant="primary" type="submit" busy={saving} disabled={saving} testid="identity-save">
          {#snippet children()}{saving ? 'Saving…' : 'Save'}{/snippet}
        </Btn>
        {#if hasMapping}
          <Btn variant="danger" testid="identity-clear" onClick={openClear}>
            {#snippet children()}Clear{/snippet}
          </Btn>
        {/if}
      </div>
    </form>
    <div class="identity-status">
      {#if saveError !== null}<p class="status-error" role="alert" data-testid="identity-save-error">{saveError}</p>{/if}
      {#if saved}<p class="status-success" role="status">Identity saved.</p>{/if}
    </div>
  {/if}
</section>

<Confirm
  open={confirmingClear}
  title="Clear identity?"
  danger
  busy={clearing}
  confirmLabel="Clear"
  onCancel={() => (confirmingClear = false)}
  onConfirm={() => void confirmClear()}
>
  {#snippet body()}
    <p>
      This removes the link between your chat account and {providerName}. The bot will stop acting as you until you set
      it again.
    </p>
    {#if clearError !== null}<p class="status-error" data-testid="identity-clear-error">{clearError}</p>{/if}
  {/snippet}
</Confirm>

<style>
  .identity-intro {
    max-width: 520px;
    margin-bottom: var(--gap-field);
    color: var(--fg2);
    font-size: 12px;
  }
  .identity-form {
    max-width: 520px;
  }
  .identity-actions {
    display: flex;
    gap: var(--gap-inline);
  }
  .identity-status {
    margin-top: var(--gap-inline);
  }
  .settings-empty-link {
    color: var(--accent);
    font-family: var(--font-mono);
    font-size: 12px;
    text-decoration: none;
  }
  .settings-empty-link:hover {
    text-decoration: underline;
  }
</style>
