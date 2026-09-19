import { describe, expect, it } from 'vitest'

import {
  discoverGE360ResourceMap,
  findGE360ResourceEndpoint
} from '../../../tools/ge360/core/src/nodejs/ge360-resource-resolver'

const document = {
  paths: {
    '/api/clienti': {
      get: {},
      post: {}
    },
    '/api/clienti/{cliente_id}': {
      get: {},
      patch: {},
      delete: {}
    },
    '/api/cantieri': {
      get: {}
    },
    '/api/cantieri/{id}': {
      get: {}
    },
    '/api/quotes': {
      get: {}
    }
  }
}

describe('GE360 OpenAPI resource resolver', () => {
  it('resolves Italian collection and detail endpoints', () => {
    expect(
      findGE360ResourceEndpoint(document, 'clienti', 'GET', false)
    ).toBe('/api/clienti')

    expect(
      findGE360ResourceEndpoint(document, 'clienti', 'GET', true)
    ).toBe('/api/clienti/{cliente_id}')
  })

  it('supports English aliases for GE360 modules', () => {
    expect(
      findGE360ResourceEndpoint(document, 'preventivi', 'GET', false)
    ).toBe('/api/quotes')
  })

  it('builds a module map without inventing missing endpoints', () => {
    const map = discoverGE360ResourceMap(document)

    expect(map.cantieri.collection_get).toBe('/api/cantieri')
    expect(map.cantieri.detail_get).toBe('/api/cantieri/{id}')
    expect(map.spese.collection_get).toBeNull()
  })
})
