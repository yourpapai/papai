<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { IdentityResponse } from '../fetcher-schemas.js'
  import { deleteIdentity, fetchIdentity, putIdentity } from '../fetchers.js'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let data: IdentityResponse | null = $state(null)
  let notice: string | null = $state(null)
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let providerUserId = $state('')
  let providerUserLogin = $state('')
  let displayName = $state('')

  async function load(id: string): Promise<void> {
    error = null
    notice = null
    status = null
    data = null
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
  <header class="settings-section-header">
    <div>
      <p class="eyebrow">Identity</p>
      <h2>Identity{#if data !== null} · {data.providerName}{/if}</h2>
    </div>
    <button type="button" onclick={() => void load(contextId)}>Refresh</button>
  </header>

  {#if notice !== null}
    <p class="placeholder">{notice}</p>
  {:else}
    {#if error !== null}<p class="status-error">{error}</p>{/if}
    {#if status !== null}<p class="status-success">{status}</p>{/if}
    <form
      class="settings-form"
      onsubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <label>
        <span>Provider user ID</span>
        <input
          data-testid="identity-user-id"
          value={providerUserId}
          oninput={(e) => (providerUserId = (e.target as HTMLInputElement).value)}
        />
      </label>
      <label>
        <span>Provider login</span>
        <input
          value={providerUserLogin}
          oninput={(e) => (providerUserLogin = (e.target as HTMLInputElement).value)}
        />
      </label>
      <label>
        <span>Display name</span>
        <input
          value={displayName}
          oninput={(e) => (displayName = (e.target as HTMLInputElement).value)}
        />
      </label>
      <button type="submit" data-testid="identity-save">Save</button>
      <button type="button" data-testid="identity-clear" onclick={() => void clear()}>Clear</button>
    </form>
  {/if}
</section>
