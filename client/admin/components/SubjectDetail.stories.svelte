<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import { makeBillingDetail, makeBillingSubject } from '../../stories/fixtures/index.js'
  import SubjectDetail from './SubjectDetail.svelte'

  const { Story } = defineMeta({
    title: 'admin/components/SubjectDetail',
    component: SubjectDetail,
  })
</script>

<Story name="DM subject" args={{ detail: makeBillingDetail() }} />

<Story
  name="Group subject"
  args={{
    detail: makeBillingDetail({
      subject: makeBillingSubject({ storageContextId: 'tg:2', contextType: 'group', displayName: 'team-alpha' }),
    }),
  }} />
