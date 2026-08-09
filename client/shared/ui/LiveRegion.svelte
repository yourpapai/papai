<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  interface Props {
    message: string | null
    tone: 'status' | 'alert'
    testid?: string
  }

  let { message, tone, testid }: Props = $props()
</script>

<!-- Always mounted, text swapped in place. A live region created in the same tick as its
     text is routinely missed by screen readers, so the element must pre-exist the
     announcement. Empty it collapses to zero height rather than unmounting, which keeps
     it in the accessibility tree. -->
{#if tone === 'alert'}
  <p class="live-region status-error" role="alert" aria-live="assertive" data-testid={testid}>{message ?? ''}</p>
{:else}
  <p class="live-region status-success" role="status" aria-live="polite" data-testid={testid}>{message ?? ''}</p>
{/if}

<style>
  .live-region {
    margin: 0;
  }
  .live-region:empty {
    height: 0;
    overflow: hidden;
  }
</style>
