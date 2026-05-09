import { describe, test } from 'bun:test'
import assert from 'node:assert/strict'

import * as commands from '../../src/commands/index.js'

describe('commands/index exports', () => {
  test('exports registerContextCommand', () => {
    assert(typeof commands.registerContextCommand === 'function')
  })
})
