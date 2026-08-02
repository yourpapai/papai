<script lang="ts">
  import SessionCard from './SessionCard.svelte'
  import Panel from '../../shared/ui/Panel.svelte'
  import EmptyState from '../../shared/ui/EmptyState.svelte'
  import type { Session, DashboardState } from '../dashboard-types.js'
  import { pinOperatorFirst } from '../session-order.js'

  interface Props {
    dashboard: DashboardState
    onSelect: (userId: string, session: Session) => void
  }

  let { dashboard, onSelect }: Props = $props()

  const entries = $derived(pinOperatorFirst([...dashboard.sessions.entries()], dashboard.operatorUserId))
</script>

<section id="sessions">
  <Panel title="sessions" count={dashboard.sessions.size}>
    {#snippet body()}
      {#if entries.length === 0}
        <EmptyState title="No sessions" hint="sessions appear here as users talk to the bot" />
      {:else}
        {#each entries as [userId, session] (userId)}
          <SessionCard
            {userId}
            {session}
            wizard={dashboard.wizards.get(userId)}
            isOperator={userId === dashboard.operatorUserId}
            selected={dashboard.selectedDetail?.kind === 'session' &&
              dashboard.selectedDetail.payload.userId === userId}
            onSelect={() => onSelect(userId, session)} />
        {/each}
      {/if}
    {/snippet}
  </Panel>
</section>
