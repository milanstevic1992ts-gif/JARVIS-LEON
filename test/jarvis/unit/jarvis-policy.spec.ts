import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  JarvisPolicyManager,
  classifyJarvisAction,
  fingerprintJarvisAction
} from '@/core/jarvis-policy/jarvis-policy-manager'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-policy-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
})

describe('JARVIS safety policy', () => {
  it('classifies reads as green, normal writes as yellow and destructive/external writes as red', () => {
    expect(
      classifyJarvisAction({
        method: 'GET',
        path: '/api/clienti',
        functionName: 'request'
      })
    ).toBe('green')

    expect(
      classifyJarvisAction({
        method: 'PATCH',
        path: '/api/clienti/42',
        functionName: 'request'
      })
    ).toBe('yellow')

    expect(
      classifyJarvisAction({
        method: 'DELETE',
        path: '/api/preventivi/9',
        functionName: 'request'
      })
    ).toBe('red')

    expect(
      classifyJarvisAction({
        method: 'POST',
        path: '/api/marketing/campaign/send',
        functionName: 'request'
      })
    ).toBe('red')
  })

  it('fingerprints equivalent parameter objects deterministically', () => {
    const base = {
      toolkitId: 'ge360',
      toolId: 'core',
      functionName: 'request',
      method: 'PATCH',
      path: '/api/clienti/42'
    }

    expect(
      fingerprintJarvisAction({
        ...base,
        params: { b: 2, a: 1 }
      })
    ).toBe(
      fingerprintJarvisAction({
        ...base,
        params: { a: 1, b: 2 }
      })
    )
  })

  it('approves an exact action once and consumes the approval', () => {
    const manager = new JarvisPolicyManager(makeTempDir())
    const action = {
      toolkitId: 'ge360',
      toolId: 'core',
      functionName: 'request',
      method: 'PATCH',
      path: '/api/clienti/42',
      params: {
        body: {
          nome: 'Cliente Test'
        }
      }
    }

    const requested = manager.requestApproval(action, 'yellow')
    expect(requested.status).toBe('pending')

    const approved = manager.approve(requested.id)
    expect(approved?.status).toBe('approved')

    const consumed = manager.consumeApproved(action)
    expect(consumed?.status).toBe('consumed')

    expect(manager.consumeApproved(action)).toBeNull()
  })

  it('does not let an approval authorize a different payload', () => {
    const manager = new JarvisPolicyManager(makeTempDir())
    const firstAction = {
      toolkitId: 'ge360',
      toolId: 'core',
      functionName: 'request',
      method: 'PATCH',
      path: '/api/clienti/42',
      params: { body: { nome: 'A' } }
    }

    const requested = manager.requestApproval(firstAction, 'yellow')
    manager.approve(requested.id)

    const changedAction = {
      ...firstAction,
      params: { body: { nome: 'B' } }
    }

    expect(manager.consumeApproved(changedAction)).toBeNull()
    expect(manager.consumeApproved(firstAction)?.status).toBe('consumed')
  })
})
