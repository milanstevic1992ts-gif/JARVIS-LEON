import type { FastifyPluginAsync } from 'fastify'

import type { APIOptions } from '@/core/http-server/http-server'
import { getBrainStatus } from '@/core/http-server/api/brain-status/get'

export const brainStatusPlugin: FastifyPluginAsync<APIOptions> = async (
  fastify,
  options
) => {
  await fastify.register(getBrainStatus, options)
}
