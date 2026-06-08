<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { IdentityResponse } from '../fetcher-schemas.js'
  import { deleteIdentity, fetchIdentity, putIdentity } from '../fetchers.js'
  import Btn from '../../shared/ui/Btn.svelte'
  import Field from '../../shared/ui/Field.svelte'
  import IconButton from '../../shared/ui/IconButton.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let data: IdentityResponse | null = $state(null)
  let notice: string | null = $state(null)
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)
  let providerUserId = $state('')
  let providerUserLogin = $state('')
  let displayName = $state('')

  const headerTitle = $derived(data !== null ? `Identity · ${data.providerName}` : 'Identity')

  async function load(id: string): Promise<void> {
    error = null
    notice = null
    status = null
    data = null
    loading = true
    try {
      const result = await fetchIdentity(id)
      data = result
      const m = result.mapping
      providerUserId = m?.providerUserId ?? ''
      providerUserLogin = m?.providerUserLogin ?? ''
      displayName = m?.displayName ?? ''
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('no task instance')) notice = message
      else error = message
    } finally {
      loading = false
    }
  }

  async function save(): Promise<void> {
    error = null
    status = null
    if (providerUserId.trim() === '') {
      error = 'Provider user ID is required.'
      return
    }
    try {
      await putIdentity({ providerUserId, providerUserLogin, displayName, contextId })
      status = 'Identity saved.'
      await load(contextId)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  async function clear(): Promise<void> {
    error = null
    status = null
    try {
      await deleteIdentity(contextId)
      status = 'Identity cleared.'
      await load(contextId)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  $effect(() => {
    void load(contextId)
  })
</script>

<section id="identity" class="settings-section">
  <PageHeader title={headerTitle}>
    {#snippet action()}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load(contextId)} testid="identity-refresh" />
    {/snippet}
  </PageHeader>

  {#if notice !== null}
    <p class="placeholder">{notice}</p>
  {:else}
    {#if error !== null}<p class="status-error">{error}</p>{/if}
    {#if status !== null}<p class="status-success">{status}</p>{/if}
    {#if loading}
      <p class="placeholder">Loading…</p>
    {:else}
      <form
        class="settings-form"
        onsubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <Field label="Provider user ID">
          {#snippet children()}
            <Input value={providerUserId} onInput={(v) => (providerUserId = v)} testid="identity-user-id" />
          {/snippet}
        </Field>
        <Field label="Provider login">
          {#snippet children()}
            <Input value={providerUserLogin} onInput={(v) => (providerUserLogin = v)} />
          {/snippet}
        </Field>
        <Field label="Display name">
          {#snippet children()}
            <Input value={displayName} onInput={(v) => (displayName = v)} />
          {/snippet}
        </Field>
        <Btn variant="primary" type="submit" testid="identity-save">{#snippet children()}Save{/snippet}</Btn>
        <Btn variant="ghost" testid="identity-clear" onClick={() => void clear()}>{#snippet children()}Clear{/snippet}</Btn>
      </form>
    {/if}
  {/if}
</section>
