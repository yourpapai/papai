<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import IdentitySection from './IdentitySection.svelte'

  const CONTEXT_ID = 'ctx-personal-1'

  const { Story } = defineMeta({
    title: 'settings/sections/IdentitySection',
    component: IdentitySection,
    args: { contextId: CONTEXT_ID },
  })
</script>

<!-- mapping present: form pre-filled with alice's identity -->
<Story name="Populated" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-identity-populated' }} />

<!-- mapping null: form with empty fields -->
<Story name="Empty" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-identity-empty' }} />

<Story name="Error" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-identity-error' }} />
<Story name="Loading" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-identity-loading' }} />
