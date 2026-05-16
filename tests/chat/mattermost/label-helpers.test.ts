// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { formatMattermostUserLabel } from '../../../src/chat/mattermost/label-helpers.js'

test('formatMattermostUserLabel formats first+last name with username', () => {
  expect(formatMattermostUserLabel('itsmike', 'John', 'Johnson', '')).toBe('John Johnson (@itsmike)')
})

test('formatMattermostUserLabel uses nickname when no first/last name', () => {
  expect(formatMattermostUserLabel('itsmike', '', '', 'JohnnyBoy')).toBe('JohnnyBoy (@itsmike)')
})

test('formatMattermostUserLabel returns only username when no display name', () => {
  expect(formatMattermostUserLabel('itsmike', '', '', '')).toBe('@itsmike')
})

test('formatMattermostUserLabel returns null when all fields are empty', () => {
  expect(formatMattermostUserLabel('', '', '', '')).toBeNull()
})

test('formatMattermostUserLabel returns display name without username when username is empty', () => {
  expect(formatMattermostUserLabel('', 'John', 'Johnson', '')).toBe('John Johnson')
})
