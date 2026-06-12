<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { DashboardState } from '../dashboard-types.js'
  import EmptyState from '../../shared/ui/EmptyState.svelte'
  import Panel from '../../shared/ui/Panel.svelte'

  interface Props {
    dashboard: DashboardState
  }

  let { dashboard }: Props = $props()

  const editorIds = $derived([...dashboard.activeConfigEditors])
  const wizards = $derived([...dashboard.wizards.values()])
</script>

<Panel title="live context">
  {#snippet body()}
    <div class="context-panel-sections">
      <div class="context-panel-section">
        {#if editorIds.length === 0 && wizards.length === 0}
          <EmptyState title="No active sessions" />
        {:else}
          <div class="context-section">
            {#each editorIds as userId (userId)}
              <div class="context-item">
                <span class="context-key">{userId}</span>
                <span class="context-value">config-editor active</span>
              </div>
            {/each}
            {#each wizards as wizard (wizard.userId)}
              <div class="context-item">
                <span class="context-key">{wizard.userId}</span>
                <span class="context-value">wizard step {wizard.currentStep}/{wizard.totalSteps}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/snippet}
</Panel>
