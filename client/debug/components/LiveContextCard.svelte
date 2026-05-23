<script lang="ts">
  import type { DashboardState } from '../dashboard-types.js'

  interface Props {
    dashboard: DashboardState
  }

  let { dashboard }: Props = $props()

  const editorIds = $derived([...dashboard.activeConfigEditors])
  const wizards = $derived([...dashboard.wizards.values()])
</script>

<section class="panel">
  <h2>Live Context</h2>
  <div class="context-panel-sections">
    <div class="context-panel-section">
      {#if editorIds.length === 0 && wizards.length === 0}
        <span class="placeholder">No active sessions</span>
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
</section>
