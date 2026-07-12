// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createScenarioEvents } from './events.js'

describe('scenario events', () => {
  test('assigns increasing sequence numbers and the current phase', () => {
    const events = createScenarioEvents('create task')

    events.record('chat.message', { text: 'create a task' })
    events.setPhase('assertions')
    events.record('chat.reply', { text: 'created' })

    expect(events.all()).toEqual([
      { seq: 1, phase: 'setup', kind: 'chat.message', data: { text: 'create a task' } },
      { seq: 2, phase: 'assertions', kind: 'chat.reply', data: { text: 'created' } },
    ])
    expect(events.recent(1)).toEqual([{ seq: 2, phase: 'assertions', kind: 'chat.reply', data: { text: 'created' } }])
  })

  test('recursively redacts sensitive metadata while preserving useful values', () => {
    const events = createScenarioEvents('redaction')

    events.record('http.request', {
      headers: {
        Authorization: 'Bearer real-token',
        'x-api-key': 'api-secret',
        accept: 'application/json',
      },
      nested: [{ refreshToken: 'refresh-secret', projectId: 'project-1' }],
      client_secret: 'client-secret',
    })

    expect(events.all()[0]?.data).toEqual({
      headers: {
        Authorization: '[REDACTED]',
        'x-api-key': '[REDACTED]',
        accept: 'application/json',
      },
      nested: [{ refreshToken: '[REDACTED]', projectId: 'project-1' }],
      client_secret: '[REDACTED]',
    })
  })

  test('redacts settings session and CSRF metadata', () => {
    const events = createScenarioEvents('settings secrets')

    events.record('settings.request', {
      cookie: 'papai_settings_session=session-secret',
      csrf: 'csrf-secret',
      headers: { 'X-Settings-CSRF': 'header-secret' },
    })

    const formatted = events.formatFailure('failed')
    expect(formatted).not.toContain('session-secret')
    expect(formatted).not.toContain('csrf-secret')
    expect(formatted).not.toContain('header-secret')
  })

  test('sanitizes nested Headers before snapshotting', () => {
    const events = createScenarioEvents('nested headers')

    expect(() =>
      events.record('http.request', {
        metadata: new Headers({ authorization: 'Bearer hidden', accept: 'application/json' }),
      }),
    ).not.toThrow()
    expect(events.all()[0]?.data).toEqual({
      metadata: { accept: 'application/json', authorization: '[REDACTED]' },
    })
  })

  test('replaces cycles with a deterministic marker', () => {
    const events = createScenarioEvents('cycles')
    const cyclic: Record<string, unknown> = { label: 'root' }
    cyclic['self'] = cyclic

    events.record('custom', cyclic)

    expect(events.all()[0]?.data).toEqual({ label: 'root', self: '[Circular]' })
    expect(events.formatFailure('failed')).toContain('"self": "[Circular]"')
  })

  test('snapshots custom prototypes without invoking accessors', () => {
    const events = createScenarioEvents('custom objects')
    let getterCalls = 0
    const custom = { safe: 'kept' }
    Reflect.setPrototypeOf(custom, { inherited: 'ignored' })
    Object.defineProperties(custom, {
      dangerous: {
        enumerable: true,
        get: () => {
          getterCalls += 1
          throw new Error('getter must not run')
        },
      },
    })

    events.record('custom', custom)

    expect(getterCalls).toBe(0)
    expect(events.all()[0]?.data).toEqual({ safe: 'kept', dangerous: '[Accessor]' })
  })

  test('redacts credential-like URL query values while preserving non-sensitive shape', () => {
    const events = createScenarioEvents('query secrets')

    events.record('http.request', {
      url: new URL('https://api.test/tasks?access_token=hidden&project=one#section'),
      callback: 'https://app.test/callback?api-key=also-hidden&state=kept',
      credentialUrl: 'https://user:password@api.test/private?view=full',
      duplicateKeys: 'https://api.test/tasks?token=one&token=two&view=all',
    })

    const data = events.all()[0]?.data
    expect(data).toEqual({
      url: 'https://api.test/tasks?access_token=%5BREDACTED%5D&project=one#section',
      callback: 'https://app.test/callback?api-key=%5BREDACTED%5D&state=kept',
      credentialUrl: 'https://%5BREDACTED%5D:%5BREDACTED%5D@api.test/private?view=full',
      duplicateKeys: 'https://api.test/tasks?token=%5BREDACTED%5D&token=%5BREDACTED%5D&view=all',
    })
    expect(events.formatFailure('failed')).not.toContain('hidden')
    expect(events.formatFailure('failed')).not.toContain('password')
  })

  test('redacts password, credential, private-key, and signature metadata without hiding descriptors', () => {
    const events = createScenarioEvents('credential metadata')

    events.record('auth.metadata', {
      password: 'password-value',
      db_passphrase: 'passphrase-value',
      clientCredentials: 'credential-value',
      private_key: 'private-key-value',
      requestSignature: 'signature-value',
      sig: 'short-signature-value',
      'X-Amz-Credential': 'aws-credential-value',
      'X-Amz-Signature': 'aws-signature-value',
      'X-Amz-Security-Token': 'aws-token-value',
      credentialType: 'assumed-role',
      signatureAlgorithm: 'AWS4-HMAC-SHA256',
      privateKeyAlgorithm: 'Ed25519',
      passwordPolicy: 'minimum-12-characters',
      publicKey: 'public-key-value',
    })

    expect(events.all()[0]?.data).toEqual({
      password: '[REDACTED]',
      db_passphrase: '[REDACTED]',
      clientCredentials: '[REDACTED]',
      private_key: '[REDACTED]',
      requestSignature: '[REDACTED]',
      sig: '[REDACTED]',
      'X-Amz-Credential': '[REDACTED]',
      'X-Amz-Signature': '[REDACTED]',
      'X-Amz-Security-Token': '[REDACTED]',
      credentialType: 'assumed-role',
      signatureAlgorithm: 'AWS4-HMAC-SHA256',
      privateKeyAlgorithm: 'Ed25519',
      passwordPolicy: 'minimum-12-characters',
      publicKey: 'public-key-value',
    })
  })

  test('preserves duplicate credential query keys while redacting each value', () => {
    const events = createScenarioEvents('credential query')

    events.record('http.request', {
      url: 'https://api.test/login?password=one&password=two&signature=signed&signature_algorithm=HMAC&credential_type=role',
    })

    expect(events.all()[0]?.data).toEqual({
      url: 'https://api.test/login?password=%5BREDACTED%5D&password=%5BREDACTED%5D&signature=%5BREDACTED%5D&signature_algorithm=HMAC&credential_type=role',
    })
  })

  test('redacts all credential fields in an AWS presigned URL', () => {
    const events = createScenarioEvents('presigned url')
    const presigned =
      'https://bucket.s3.amazonaws.com/report.csv?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIA%2F20260712%2Fregion%2Fs3%2Faws4_request&X-Amz-Date=20260712T120000Z&X-Amz-Expires=900&X-Amz-Security-Token=session-token&X-Amz-Signature=deadbeef'

    events.record('storage.url', { presigned })

    expect(events.all()[0]?.data).toEqual({
      presigned:
        'https://bucket.s3.amazonaws.com/report.csv?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=%5BREDACTED%5D&X-Amz-Date=20260712T120000Z&X-Amz-Expires=900&X-Amz-Security-Token=%5BREDACTED%5D&X-Amz-Signature=%5BREDACTED%5D',
    })
    expect(events.formatFailure('failed')).not.toContain('deadbeef')
    expect(events.formatFailure('failed')).not.toContain('AKIA')
    expect(events.formatFailure('failed')).not.toContain('session-token')
  })

  test('returns snapshots that cannot mutate recorded events', () => {
    const events = createScenarioEvents('snapshots')
    const source = { nested: { value: 'original' } }
    events.record('custom', source)

    source.nested.value = 'changed'
    const [recorded] = events.all()
    Reflect.set(Object(recorded), 'phase', 'leaked')

    expect(events.all()[0]).toEqual({
      seq: 1,
      phase: 'setup',
      kind: 'custom',
      data: { nested: { value: 'original' } },
    })
  })

  test('formats deterministic failures with scenario, phase, recent events, and no secrets', () => {
    const events = createScenarioEvents('failed story')
    events.setPhase('when message')
    events.record('http.request', { authorization: 'Bearer hidden', url: 'https://example.test/tasks' })

    const formatted = events.formatFailure('unexpected request')

    expect(formatted).toContain('scenario: failed story')
    expect(formatted).toContain('phase: when message')
    expect(formatted).toContain('unexpected request')
    expect(formatted).toContain('[REDACTED]')
    expect(formatted).not.toContain('Bearer hidden')
    expect(formatted).toBe(events.formatFailure('unexpected request'))
  })
})
