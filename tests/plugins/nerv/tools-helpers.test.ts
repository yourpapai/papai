// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { asObject } from '../../../plugins/nerv/client.js'
import { deriveProjectPath, isDefinitelyNotGitlab, resolveProjectNames, taskIdOf } from '../../../plugins/nerv/tools.js'

test('deriveProjectPath strips host, leading slash, and .git', () => {
  expect(deriveProjectPath('https://gitlab.com/group/sub/repo.git')).toBe('group/sub/repo')
  expect(deriveProjectPath('https://gitlab.corp.example/team/app')).toBe('team/app')
  expect(deriveProjectPath('https://gitlab.com/group/repo/')).toBe('group/repo')
  expect(deriveProjectPath('not a url')).toBeNull()
})

test('isDefinitelyNotGitlab rejects github.com but passes gitlab + self-hosted', () => {
  expect(isDefinitelyNotGitlab('https://github.com/a/b.git')).toBe(true)
  expect(isDefinitelyNotGitlab('https://gitlab.com/a/b.git')).toBe(false)
  expect(isDefinitelyNotGitlab('https://gitlab.corp.example/a/b')).toBe(false)
})

test('resolveProjectNames accepts project string or projects array', () => {
  expect(resolveProjectNames(asObject({ project: 'demo' }))).toEqual(['demo'])
  expect(resolveProjectNames(asObject({ projects: ['a', 'b'] }))).toEqual(['a', 'b'])
  expect(resolveProjectNames(asObject({ projects: ['a', ''], project: 'demo' }))).toEqual(['demo', 'a'])
  expect(resolveProjectNames(asObject({}))).toEqual([])
})

test('taskIdOf extracts a non-empty taskId', () => {
  expect(taskIdOf({ taskId: 't1' })).toBe('t1')
  expect(taskIdOf({ taskId: '' })).toBeNull()
  expect(taskIdOf('nope')).toBeNull()
})
