export type GE360Resource =
  | 'cantieri'
  | 'clienti'
  | 'preventivi'
  | 'spese'
  | 'materiali'
  | 'attrezzi'
  | 'furgone'
  | 'marketing'

export interface GE360OpenAPIDocument {
  info?: Record<string, unknown>
  paths?: Record<string, Record<string, unknown>>
}

const RESOURCE_ALIASES: Record<GE360Resource, string[]> = {
  cantieri: ['cantieri', 'cantiere', 'jobsites', 'jobsite', 'projects', 'project'],
  clienti: ['clienti', 'cliente', 'clients', 'client', 'customers', 'customer'],
  preventivi: ['preventivi', 'preventivo', 'quotes', 'quote', 'estimates', 'estimate'],
  spese: ['spese', 'spesa', 'expenses', 'expense', 'costs', 'cost'],
  materiali: ['materiali', 'materiale', 'materials', 'material'],
  attrezzi: ['attrezzi', 'attrezzo', 'tools', 'equipment'],
  furgone: ['furgone', 'van', 'vehicle', 'vehicles'],
  marketing: ['marketing', 'prospex', 'campaign', 'campaigns', 'leads', 'lead']
}

export function findGE360ResourceEndpoint(
  document: GE360OpenAPIDocument,
  resource: GE360Resource,
  method: string,
  detail: boolean
): string | null {
  const aliases = RESOURCE_ALIASES[resource]
  const candidates: Array<{ path: string, score: number }> = []

  for (const [endpointPath, definition] of Object.entries(document.paths || {})) {
    const normalizedPath = endpointPath.toLowerCase()
    const methodDefinition = definition?.[method.toLowerCase()]

    if (!methodDefinition) {
      continue
    }

    const aliasMatches = aliases.filter((alias) =>
      normalizedPath.includes(alias)
    ).length

    if (aliasMatches === 0) {
      continue
    }

    const hasParameter = /\{[^}]+\}/.test(endpointPath)
    if (detail !== hasParameter) {
      continue
    }

    let score = aliasMatches * 10

    if (normalizedPath.includes('/' + resource)) {
      score += 8
    }

    if (endpointPath.startsWith('/api/')) {
      score += 3
    }

    if (!detail && endpointPath.split('/').filter(Boolean).length <= 3) {
      score += 2
    }

    if (detail && [...endpointPath.matchAll(/\{[^}]+\}/g)].length === 1) {
      score += 4
    }

    candidates.push({ path: endpointPath, score })
  }

  candidates.sort(
    (a, b) => b.score - a.score || a.path.length - b.path.length
  )

  return candidates[0]?.path || null
}

export function discoverGE360ResourceMap(
  document: GE360OpenAPIDocument
): Record<GE360Resource, { collection_get: string | null, detail_get: string | null }> {
  return Object.fromEntries(
    (Object.keys(RESOURCE_ALIASES) as GE360Resource[]).map((resource) => [
      resource,
      {
        collection_get: findGE360ResourceEndpoint(
          document,
          resource,
          'GET',
          false
        ),
        detail_get: findGE360ResourceEndpoint(
          document,
          resource,
          'GET',
          true
        )
      }
    ])
  ) as Record<
    GE360Resource,
    { collection_get: string | null, detail_get: string | null }
  >
}
