'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = joi.reach(schema.models.pipeline.base, 'admins').get;
const idSchema = joi.reach(schema.models.pipeline.base, 'id');

module.exports = () => ({
    method: 'GET',
    path: '/pipelines/{id}/admin',
    config: {
        description: 'Get the pipeline admin',
        notes: 'Returns a pipeline admin record',
        tags: ['api', 'pipelines'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build', 'pipeline']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: async (request, reply) => {
            try {
                const factory = request.server.app.pipelineFactory;
                const pipeline = await factory.get(request.params.id);

                if (!pipeline) {
                    throw boom.notFound('Pipeline does not exist');
                }

                const admin = await pipeline.admin();

                return reply(admin);
            } catch (err) {
                return reply(boom.boomify(err));
            }
        },
        response: {
            schema: getSchema
        },
        validate: {
            params: {
                id: idSchema
            }
        }
    }
});
