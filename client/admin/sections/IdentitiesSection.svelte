<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { IdentityMappingEntry } from '../../shared/api-types.js'
  import { fetchAdminIdentity } from '../fetchers.js'

  let userId = $state('')
  let provider = $state('task-provider')
  let mapping: IdentityMappingEntry | null = $state(null)
  let hasLoaded = $state(false)
  let loading = $state(false)
  let error: string | null = $state(null)

  async function loadIdentity(): Promise<void> {
    if (userId.trim() === '' || provider.trim() === '') return
    loading = true
    error = null
    try {
      mapping = await fetchAdminIdentity(userId.trim(), provider.trim())
      hasLoaded = true
    } catch (err) {
      hasLoaded = true
      mapping = null
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault()
    void loadIdentity()
  }
</script>

<section class="panel admin-data-section">
  <header class="admin-section-header">
    <div>
      <p class="eyebrow">Mappings</p>
      <h2 data-testid="admin-section-title">Identities</h2>
    </div>
  </header>

  <form class="admin-filter-form" onsubmit={submit}>
    <label>
      <span>User ID</span>
      <input data-testid="identity-user-id" bind:value={userId} placeholder="user id" type="text" />
    </label>
    <label>
      <span>Provider</span>
      <input data-testid="identity-provider" bind:value={provider} placeholder="kaneo" type="text" />
    </label>
    <button data-testid="identity-load" disabled={userId.trim() === '' || provider.trim() === '' || loading} type="submit">
      {loading ? 'Loading...' : 'Load'}
    </button>
  </form>

  {#if error !== null}
    <p class="status-error">{error}</p>
  {:else if hasLoaded && mapping === null}
    <p class="placeholder">No identity mapping found</p>
  {:else if mapping !== null}
    <dl class="admin-key-value-list">
      <div><dt>Context ID</dt><dd>{mapping.contextId}</dd></div>
      <div><dt>Provider</dt><dd>{mapping.providerName}</dd></div>
      <div><dt>Provider user ID</dt><dd>{mapping.providerUserId ?? 'Unmatched'}</dd></div>
      <div><dt>Login</dt><dd>{mapping.providerUserLogin ?? 'Unknown'}</dd></div>
      <div><dt>Display name</dt><dd>{mapping.displayName ?? 'Unknown'}</dd></div>
      <div><dt>Matched at</dt><dd>{mapping.matchedAt}</dd></div>
      <div><dt>Match method</dt><dd>{mapping.matchMethod ?? 'Unknown'}</dd></div>
      <div><dt>Confidence</dt><dd>{mapping.confidence ?? 'Unknown'}</dd></div>
    </dl>
  {/if}
</section>
