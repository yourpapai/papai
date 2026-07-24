// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { runSmallModel } from './small-model-contract.js'

async function readStdin(): Promise<unknown> {
  const text = await Bun.stdin.text()
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const result = await runSmallModel(await readStdin(), {
  approved: process.env['PAPAI_ANALYTICS_CLASSIFIER_APPROVED'] === 'true',
  endpoint: process.env['PAPAI_ANALYTICS_SMALL_MODEL_ENDPOINT'],
  apiKey: process.env['PAPAI_ANALYTICS_SMALL_MODEL_API_KEY'],
  model: process.env['PAPAI_ANALYTICS_SMALL_MODEL'],
})

if (result.ok) {
  console.log(JSON.stringify(result.result))
} else {
  console.error(JSON.stringify({ code: result.code }))
  process.exitCode = 2
}
