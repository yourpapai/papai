<script lang="ts">
  import SessionCard from './SessionCard.svelte'
  import type { Session, DashboardState } from '../dashboard-types.js'

  interface Props {
    dashboard: DashboardState
    onSelect: (userId: string, session: Session) => void
  }

  let { dashboard, onSelect }: Props = $props()

  const entries = $derived([...dashboard.sessions.entries()])
</script>

<section id="sessions">
  <h2>Sessions <span class="count-badge">{dashboard.sessions.size}</span></h2>
  <div>
    {#each entries as [userId, session] (userId)}
      <SessionCard
        {userId}
        {session}
        wizard={dashboard.wizards.get(userId)}
        onSelect={() => onSelect(userId, session)} />
    {/each}
  </div>
</section>
