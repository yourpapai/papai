// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { scenario } from '../harness/scenario.js'
import { answer, callCapability, promptTextFingerprint } from '../harness/scripted-llm.js'

const ARTICLE_URL = 'https://example.com/article'
// A single unscriptable word present ONLY in the intercepted body — never in any tool input or
// reply string. Its fingerprint on the tool result proves the real fetched body reached the model.
const BODY_MARKER = 'papaifetchmarker7q'
const ARTICLE_HTML =
  '<!doctype html><html><head><title>Release notes</title></head><body>' +
  '<h1>Release notes</h1>' +
  `<p>The deployment completed successfully. The verification marker ${BODY_MARKER} ` +
  'confirms the fetched body reached the tool result.</p>' +
  '<p>No further action is required for this release.</p>' +
  '</body></html>'

scenario(
  'SCN-web-fetch: fetching a public page surfaces its content and serves a second turn from cache',
  async ({ given, when, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    given.allowPublicUrl()
    // ONE declared GET. Turn 1 consumes it and writes web_cache; Turn 2 must be served from cache —
    // a second outbound would hit `expectations[1]` (undefined) and throw "undeclared request".
    world.http.expect({ method: 'GET', url: ARTICLE_URL }, () =>
      Promise.resolve(
        new Response(ARTICLE_HTML, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }),
      ),
    )
    given.llm([
      callCapability('web.fetch', { url: ARTICLE_URL }),
      answer('Here is the release note you asked for.'),
      callCapability('web.fetch', { url: ARTICLE_URL }),
      answer('Same release note, served again.'),
    ])

    // Turn 1: real outbound fetch → the intercepted body's marker surfaces on the tool result.
    await when.message(alice, dm, 'Please read https://example.com/article')
    expect(world.model.inspections().at(-1)?.promptToolResultTokenFingerprints).toContain(
      promptTextFingerprint(BODY_MARKER),
    )

    // Turn 2: same URL → served from the durable web_cache row (no second outbound). The marker is
    // still present, and teardown's verifyConsumed proves exactly one GET occurred.
    await when.message(alice, dm, 'Read it again please')
    expect(world.model.inspections().at(-1)?.promptToolResultTokenFingerprints).toContain(
      promptTextFingerprint(BODY_MARKER),
    )
  },
)

scenario(
  'SCN-web-fetch-rate-limit-deny: an exhausted quota denies the fetch with no outbound request',
  async ({ given, when, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    // Seed a full quota bucket for this DM's actor. NO world.http.expect is declared — the quota
    // gate throws before any fetch, and any outbound would trip the strict dispatcher.
    given.exhaustedWebFetchQuota(dm)
    given.llm([callCapability('web.fetch', { url: ARTICLE_URL }), answer('I could not fetch that right now.')])

    await when.message(alice, dm, 'Please read https://example.com/article')

    // The real tool result is a rate-limited failure: buildToolFailureResult carries
    // error: 'Web fetch quota exceeded' and errorCode: 'rate-limited'. 'exceeded' appears ONLY in
    // that failure — if the quota were not enforced (tool fetched/succeeded), it would be absent.
    expect(world.model.inspections().at(-1)?.promptToolResultTokenFingerprints).toContain(
      promptTextFingerprint('exceeded'),
    )
  },
)
