<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { formatTime } from '../../shared/helpers.js'
  import type { BillingSubject } from '../../shared/api-types.js'

  interface Props {
    subjects: readonly BillingSubject[]
    onSelect: (subject: BillingSubject) => void
  }

  let { subjects, onSelect }: Props = $props()

  function displayLabel(subject: BillingSubject): string {
    if (subject.displayName !== null && subject.displayName !== '') return subject.displayName
    return subject.storageContextId
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
            onkeydown={(event: KeyboardEvent) => {
              if (event.key === 'Enter' || event.key === ' ') onSelect(subject)
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
