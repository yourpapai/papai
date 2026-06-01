<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Pill from './Pill.svelte'
  import { statusTone } from './status-tone.js'

  interface Props {
    status: string
    dot?: boolean
  }

  let { status, dot = true }: Props = $props()

  const tone = $derived(statusTone(status))
  const showDot = $derived(dot && tone !== 'neutral' && tone !== 'mute')
</script>

<Pill {tone} dot={showDot}>{status}</Pill>
