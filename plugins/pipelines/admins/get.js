'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.pipeline.base.extract('admins').get;
const idSchema = schema.models.pipeline.base.extract('id');

module.exports = () => ({
    method: 'GET',
    path: '/pipelines/{id}/admin',
    options: {
        description: 'Get the pipeline admin',
        notes: 'Returns a pipeline admin record',
        tags: ['api', 'pipelines'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'pipeline', '!guest']
        },

        handler: async (request, h) => {
            const factory = request.server.app.pipelineFactory;
            const pipeline = await factory.get(request.params.id);

            if (!pipeline) {
                throw boom.notFound('Pipeline does not exist');
            }

            try {
                const admin = await pipeline.getFirstAdmin();
            } catch (e) {
                throw boom.notFound(e);
            }

            return h.response(admin);
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
