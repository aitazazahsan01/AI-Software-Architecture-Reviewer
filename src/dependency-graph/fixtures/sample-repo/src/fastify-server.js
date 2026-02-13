// WIP: Initial module design - fastify-server.js
import Fastify from 'fastify';

const fastify = Fastify();

fastify.route({
  method: 'GET',
  url: '/orders/:id',
  handler: async (request, reply) => {
    return { id: request.params.id };
  },
});

export default fastify;
