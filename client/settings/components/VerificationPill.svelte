<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  import Pill from '../../shared/ui/Pill.svelte'
  import type { Verification } from '../fetcher-schemas-llm-providers.js'

  interface Props {
    verification: Verification
    children?: Snippet
  }

  let { verification, children }: Props = $props()

  type Tone = 'accent' | 'warn' | 'danger' | 'mute'

  const config = $derived.by((): { tone: Tone; text: string } => {
    switch (verification.status) {
      case 'verified': return { tone: 'accent', text: 'Verified' }
      case 'error': return { tone: 'danger', text: 'Error' }
      default: return { tone: 'mute', text: 'Unverified' }
    }
  })
</script>

<span data-testid="verification-pill" title={verification.error ?? undefined}>
  <Pill tone={config.tone} dot>
    {#snippet children()}
      {#if children}{@render children()}{:else}{config.text}{/if}
    {/snippet}
  </Pill>
</span>
