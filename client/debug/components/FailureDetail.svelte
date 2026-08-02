<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { formatTime } from '../../shared/helpers.js'
  import Btn from '../../shared/ui/Btn.svelte'
  import SummaryList from '../../shared/ui/SummaryList.svelte'
  import TreeView from '../../shared/TreeView.svelte'
  import { formatScope } from '../scope-label.js'
  import type { ToolFailure } from '../dashboard-types.js'

  interface Props {
    failure: ToolFailure
  }

  let { failure }: Props = $props()

  let showRaw = $state(false)

  const toolName = $derived(typeof failure.data['toolName'] === 'string' ? failure.data['toolName'] : 'unknown')
  const errorText = $derived(typeof failure.data['error'] === 'string' ? failure.data['error'] : '')
  const retriable = $derived(
    failure.data['retriable'] === true ? 'retriable' : failure.data['retriable'] === false ? 'non-retriable' : undefined,
  )

  const basicInfo = $derived.by(() => {
    const items = [
      { k: 'Tool', v: toolName },
      { k: 'Time', v: formatTime(failure.timestamp) },
      { k: 'Scope', v: formatScope(failure.scope) },
    ]
    if (retriable !== undefined) items.push({ k: 'Retriable', v: retriable })
    return items
  })
</script>

<div class="session-detail-section">
  <h4>Tool Failure</h4>
  <SummaryList items={basicInfo} />
</div>

{#if errorText !== ''}
  <div class="session-detail-section">
    <h4>Error</h4>
    <pre class="tool-json error">{errorText}</pre>
  </div>
{/if}

<div class="session-detail-section">
  <Btn variant="ghost" size="sm" onClick={() => (showRaw = !showRaw)}>
    {#snippet children()}{showRaw ? 'hide raw' : 'show raw'}{/snippet}
  </Btn>
  {#if showRaw}
    <div class="tree-container">
      <TreeView value={failure} />
    </div>
  {/if}
</div>
