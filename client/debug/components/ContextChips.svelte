<script lang="ts">
  import type { DashboardState } from '../dashboard-types.js'

  interface Props {
    dashboard: DashboardState
  }

  let { dashboard }: Props = $props()

  const chips = $derived.by(() => {
    const seen = new Set<string>()
    seen.add('all')
    seen.add('dm')
    for (const turn of dashboard.turns) {
      if (turn.scope.kind === 'group' && turn.scope.groupId !== undefined) {
        seen.add(`group:${turn.scope.groupId}`)
      }
    }
    for (const n of dashboard.notifications) {
      if (n.scope.kind === 'group' && n.scope.groupId !== undefined) {
        seen.add(`group:${n.scope.groupId}`)
      }
    }
    for (const f of dashboard.toolFailures) {
      if (f.scope.kind === 'group' && f.scope.groupId !== undefined) {
        seen.add(`group:${f.scope.groupId}`)
      }
    }
    return [...seen]
  })
</script>

<div class="context-chips">
  {#each chips as ctx (ctx)}
    <button
      type="button"
      class="chip"
      class:active={ctx === dashboard.activeContext}
      onclick={() => (dashboard.activeContext = ctx)}>{ctx}</button>
  {/each}
</div>
