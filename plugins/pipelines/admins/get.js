'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.pipeline.base.extract('admins').get;
const idSchema = schema.models.pipeline.base.extract('id');

module.exports = () => ({
    method: 'GET',
    path: '/pipelines/{id}/admin',
    config: {
        description: 'Get the pipeline admin',
        notes: 'Returns a pipeline admin record',
        tags: ['api', 'pipelines'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'pipeline', '!guest']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: async (request, h) => {
            try {
                const factory = request.server.app.pipelineFactory;
                const pipeline = await factory.get(request.params.id);

                if (!pipeline) {
                    throw boom.notFound('Pipeline does not exist');
                }

                const admin = await pipeline.getFirstAdmin();

                return h.response(admin);
            } catch (err) {
                return h.response(boom.boomify(err));
            }
        },
        response: {
            schema: getSchema
        },
        validate: {
            params: joi.object({
                id: idSchema
            })
        }
    }
});
