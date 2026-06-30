<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import ByokSection from './ByokSection.svelte'

  const CONTEXT_ID = 'ctx-personal-1'

  const { Story } = defineMeta({
    title: 'settings/sections/ByokSection',
    component: ByokSection,
    args: { contextId: CONTEXT_ID },
  })
</script>

<!-- enabled, secret stored: masked value + Replace button -->
<Story name="Secret set" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-byok-secret-set' }} />

<!-- enabled, required key missing: missing-fields error + open editor -->
<Story name="Missing required" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-byok-missing' }} />

<!-- disabled: using central credentials -->
<Story name="Disabled" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-byok-disabled' }} />

<Story name="Error" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-byok-error' }} />

<Story name="Loading" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-byok-loading' }} />
