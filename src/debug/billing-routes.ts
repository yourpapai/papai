// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getBillingDetail, listBillingSubjects, parseWindow } from './billing.js'

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

export const handleBillingSubjects = (url: URL): Response => {
  const window = parseWindow(url.searchParams.get('window'))
  if (window === null) {
    return jsonResponse(400, { error: 'unknown window' })
  }
  const subjects = listBillingSubjects(window)
  return jsonResponse(200, { window, subjects })
}

export const handleBillingSubject = (url: URL): Response => {
  const window = parseWindow(url.searchParams.get('window'))
  if (window === null) {
    return jsonResponse(400, { error: 'unknown window' })
  }
  const rawId = url.pathname.slice('/billing/subject/'.length)
  if (rawId === '') {
    return jsonResponse(400, { error: 'missing subject id' })
  }
  const subjectId = decodeURIComponent(rawId)
  const detail = getBillingDetail(subjectId, window)
  if (detail === null) {
    return jsonResponse(404, { error: 'subject not found' })
  }
  return jsonResponse(200, { window, ...detail })
}
