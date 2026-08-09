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
     announcement. That also rules out branching the markup on `tone`: Svelte does not
     reconcile DOM nodes across {#if}/{:else} branches, so flipping `tone` would destroy
     and recreate the element in the same tick as the new text, reintroducing the exact
     failure this component exists to prevent. A single element with bound attributes
     survives the tone change instead. Empty it collapses to zero height rather than
     unmounting, which keeps it in the accessibility tree. -->
<p
  class="live-region {tone === 'alert' ? 'status-error' : 'status-success'}"
  role={tone === 'alert' ? 'alert' : 'status'}
  aria-live={tone === 'alert' ? 'assertive' : 'polite'}
  data-testid={testid}
>{message ?? ''}</p>

<style>
  .live-region {
    margin: 0;
  }
  .live-region:empty {
    height: 0;
    overflow: hidden;
  }
</style>
