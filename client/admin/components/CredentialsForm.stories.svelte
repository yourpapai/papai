<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import { makeAdminLlmSnapshot } from '../../stories/fixtures/index.js'
  import CredentialsForm from './CredentialsForm.svelte'

  const { Story } = defineMeta({
    title: 'admin/components/CredentialsForm',
    component: CredentialsForm,
  })

  const refresh = () => Promise.resolve()
</script>

<Story name="Configured" args={{ snapshot: makeAdminLlmSnapshot(), onRefresh: refresh }} />

<Story name="Unconfigured" args={{ snapshot: null, onRefresh: refresh }} />
