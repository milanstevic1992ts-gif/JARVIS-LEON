import type { FastifyPluginAsync } from 'fastify'

import type { APIOptions } from '@/core/http-server/http-server'
import { postBrainControl } from '@/core/http-server/api/brain-control/post'

export const brainControlPlugin: FastifyPluginAsync<APIOptions> = async (
  fastify,
  options
) => {
  await fastify.register(postBrainControl, options)
}
