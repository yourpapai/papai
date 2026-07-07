<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import GroupProviderSection from '../../../../client/settings/sections/GroupProviderSection.svelte'
  import { raceState } from './section-race-harness.svelte.js'
</script>

<GroupProviderSection contextId={raceState.contextId} />
