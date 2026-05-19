<script lang="ts">
  import type { DashboardState } from '../dashboard-types.js'

  interface Props {
    dashboard: DashboardState
  }

  let { dashboard }: Props = $props()

  const identityEntries = $derived([...dashboard.identityMappings.entries()])
  const editorIds = $derived([...dashboard.activeConfigEditors])
  const wizardEntries = $derived([...dashboard.wizards.entries()])
  const groups = $derived(dashboard.authorizedGroups)
</script>

<section class="panel">
  <h2>Context</h2>
  <div class="context-panel-sections">
    <div class="context-panel-section">
      <h3>Identity Mappings</h3>
      {#if identityEntries.length === 0}
        <span class="placeholder">No identity mappings</span>
      {:else}
        <div class="context-section">
          {#each identityEntries as [userId, m] (userId)}
            <div class="context-item">
              <span class="context-key">{userId}</span>
              <span class="context-value">{m.provider} → {m.providerUserId ?? 'unmatched'}</span>
              {#if m.displayName !== null}
                <span class="context-meta">{m.displayName}</span>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="context-panel-section">
      <h3>Config Editor / Wizard</h3>
      {#if editorIds.length === 0 && wizardEntries.length === 0}
        <span class="placeholder">No active sessions</span>
      {:else}
        <div class="context-section">
          {#each editorIds as userId (userId)}
            <div class="context-item">
              <span class="context-key">{userId}</span>
              <span class="context-value">config-editor active</span>
            </div>
          {/each}
          {#each wizardEntries as [userId, w] (userId)}
            <div class="context-item">
              <span class="context-key">{userId}</span>
              <span class="context-value">wizard step {w.currentStep}/{w.totalSteps}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="context-panel-section">
      <h3>Authorized Groups</h3>
      {#if groups.length === 0}
        <span class="placeholder">No authorized groups</span>
      {:else}
        <div class="context-section">
          {#each groups as g (g.group_id)}
            <div class="context-item">
              <span class="context-key">{g.group_id}</span>
              <span class="context-meta">by {g.added_by}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</section>
