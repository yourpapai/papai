<script lang="ts">
  import SessionCard from './SessionCard.svelte'
  import Panel from '../../shared/ui/Panel.svelte'
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
      {#each entries as [userId, session] (userId)}
        <SessionCard
          {userId}
          {session}
          wizard={dashboard.wizards.get(userId)}
          isOperator={userId === dashboard.operatorUserId}
          onSelect={() => onSelect(userId, session)} />
      {/each}
    {/snippet}
  </Panel>
</section>
