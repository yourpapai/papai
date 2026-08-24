// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { validateConfig } from '../../../plugins/task-provider-github/validate-config.js'

describe('validateConfig', () => {
  describe('repo', () => {
    test('valid owner/repo returns ok: true', async () => {
      const result = await validateConfig({ repo: 'octocat/hello-world' })
      expect(result).toEqual({ ok: true })
    })

    test('rejects owner/ (empty repo segment)', async () => {
      const result = await validateConfig({ repo: 'owner/' })
      expect(result).toEqual({ ok: false, reason: 'repo must be in owner/repo form' })
    })

    test('rejects /repo (empty owner segment)', async () => {
      const result = await validateConfig({ repo: '/repo' })
      expect(result).toEqual({ ok: false, reason: 'repo must be in owner/repo form' })
    })

    test('rejects owner (missing slash)', async () => {
      const result = await validateConfig({ repo: 'owner' })
      expect(result).toEqual({ ok: false, reason: 'repo must be in owner/repo form' })
    })

    test('rejects owner /repo (whitespace)', async () => {
      const result = await validateConfig({ repo: 'owner /repo' })
      expect(result).toEqual({ ok: false, reason: 'repo must be in owner/repo form' })
    })

    test('rejects owner/repo/extra (three segments)', async () => {
      const result = await validateConfig({ repo: 'owner/repo/extra' })
      expect(result).toEqual({ ok: false, reason: 'repo must be in owner/repo form' })
    })

    test('missing repo returns ok: false with repo reason', async () => {
      const result = await validateConfig({})
      expect(result).toEqual({ ok: false, reason: 'repo is required' })
    })

    test('empty repo returns ok: false with repo reason', async () => {
      const result = await validateConfig({ repo: '' })
      expect(result).toEqual({ ok: false, reason: 'repo is required' })
    })
  })

  describe('baseUrl', () => {
    test('absent baseUrl returns ok: true', async () => {
      const result = await validateConfig({ repo: 'owner/repo' })
      expect(result).toEqual({ ok: true })
    })

    test('empty baseUrl returns ok: true', async () => {
      const result = await validateConfig({ repo: 'owner/repo', baseUrl: '' })
      expect(result).toEqual({ ok: true })
    })

    test('whitespace-only baseUrl returns ok: true', async () => {
      const result = await validateConfig({ repo: 'owner/repo', baseUrl: '   ' })
      expect(result).toEqual({ ok: true })
    })

    test('valid https GHES baseUrl returns ok: true', async () => {
      const result = await validateConfig({ repo: 'owner/repo', baseUrl: 'https://ghes.example.com/api/v3' })
      expect(result).toEqual({ ok: true })
    })

    test('valid http baseUrl returns ok: true', async () => {
      const result = await validateConfig({ repo: 'owner/repo', baseUrl: 'http://localhost:3000' })
      expect(result).toEqual({ ok: true })
    })

    test('malformed baseUrl returns ok: false', async () => {
      const result = await validateConfig({ repo: 'owner/repo', baseUrl: 'not-a-url' })
      expect(result).toEqual({ ok: false, reason: 'baseUrl must be a valid URL' })
    })

    test('non-http protocol returns ok: false with http reason', async () => {
      const result = await validateConfig({ repo: 'owner/repo', baseUrl: 'ftp://host' })
      expect(result).toEqual({ ok: false, reason: 'baseUrl must use http or https' })
    })
  })

  describe('token', () => {
    test('ignores the token key when config is otherwise valid', async () => {
      const result = await validateConfig({ repo: 'owner/repo', token: 'ghp_whatever' })
      expect(result).toEqual({ ok: true })
    })

    test('a present token does not make an invalid repo valid', async () => {
      const result = await validateConfig({ repo: 'owner', token: 'ghp_whatever' })
      expect(result).toEqual({ ok: false, reason: 'repo must be in owner/repo form' })
    })
  })
})
