<script lang="ts">
  import { formatTime } from '../helpers.js'
  import type { BillingSubject } from '../dashboard-types.js'

  interface Props {
    subjects: readonly BillingSubject[]
    onSelect: (subject: BillingSubject) => void
  }

  let { subjects, onSelect }: Props = $props()

  function displayLabel(s: BillingSubject): string {
    if (s.displayName !== null && s.displayName !== '') return s.displayName
    return s.storageContextId
  }
</script>

<section class="subjects-table">
  <h3>Subjects <span class="count-badge">{subjects.length}</span></h3>
  {#if subjects.length === 0}
    <span class="placeholder">No usage in the selected window</span>
  {:else}
    <table>
      <thead>
        <tr>
          <th>Subject</th>
          <th>Type</th>
          <th>Main in/out</th>
          <th>Small in/out</th>
          <th>Embedding in</th>
          <th>Tools</th>
          <th>Last active</th>
        </tr>
      </thead>
      <tbody>
        {#each subjects as subject (subject.storageContextId)}
          <tr
            data-testid="subject-row"
            onclick={() => onSelect(subject)}
            onkeydown={(e: KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') onSelect(subject)
            }}
            tabindex="0"
            role="button">
            <td>{displayLabel(subject)}</td>
            <td>{subject.contextType}</td>
            <td>{subject.totals.main.inputTokens} / {subject.totals.main.outputTokens}</td>
            <td>{subject.totals.small.inputTokens} / {subject.totals.small.outputTokens}</td>
            <td>{subject.totals.embedding.inputTokens}</td>
            <td>{subject.toolCalls}</td>
            <td>{formatTime(new Date(subject.lastActiveAt).toISOString())}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>
