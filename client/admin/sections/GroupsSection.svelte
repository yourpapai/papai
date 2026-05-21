<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { untrack } from 'svelte'

  import type { AuthorizedGroupEntry } from '../../shared/api-types.js'
  import { fetchAdminGroups } from '../fetchers.js'

  let groups: AuthorizedGroupEntry[] = $state([])
  let loading = $state(false)
  let error: string | null = $state(null)
  let hasLoaded = $state(false)

  async function loadGroups(): Promise<void> {
    loading = true
    error = null
    try {
      groups = await fetchAdminGroups()
      hasLoaded = true
    } catch (err) {
      hasLoaded = true
      groups = []
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  $effect(() => {
    untrack(() => {
      void loadGroups()
    })
  })
</script>

<section class="panel admin-data-section">
  <header class="admin-section-header">
    <div>
      <p class="eyebrow">Access</p>
      <h2 data-testid="admin-section-title">Groups</h2>
    </div>
    <button
      type="button"
      onclick={() => {
        void loadGroups()
      }}>{loading ? 'Refreshing...' : 'Refresh'}</button>
  </header>

  {#if error !== null}
    <p class="status-error">{error}</p>
  {:else if hasLoaded && groups.length === 0}
    <p class="placeholder">No authorized groups found</p>
  {:else if groups.length > 0}
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead>
          <tr>
            <th>Group ID</th>
            <th>Added by</th>
            <th>Added at</th>
          </tr>
        </thead>
        <tbody>
          {#each groups as group (group.group_id)}
            <tr>
              <td>{group.group_id}</td>
              <td>{group.added_by}</td>
              <td>{group.added_at}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
