'use strict';

const boom = require('@hapi/boom');
const schema = require('screwdriver-data-schema');
const joi = require('joi');
const listSchema = joi.array().items(schema.models.templateMeta.get).label('List of pipeline templates');
const listCountSchema = joi
    .object()
    .keys({
        count: joi.number(),
        rows: listSchema
    })
    .label('Pipeline Template Count and List of templates');

module.exports = () => ({
    method: 'GET',
    path: '/pipeline/templates',
    options: {
        description: 'List all the pipeline templates',
        notes: 'Returns an array template meta for all the pipeline templates',
        tags: ['api', 'pipeline', 'template'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build']
        },
        handler: async (request, h) => {
            const { pipelineTemplateFactory } = request.server.app;

            const { page, sort, sortBy, count } = request.query;
            const config = { sort };

            if (sortBy) {
                config.sortBy = sortBy;
            }

            if (page || count) {
                config.paginate = { page, count };
            }

            const pipelineTemplates = await pipelineTemplateFactory.list(config);

            if (!pipelineTemplates || pipelineTemplates.length === 0) {
                throw boom.notFound('Pipeline templates do not exist');
            }

            return h.response(pipelineTemplates).code(200);
        },
        response: {
            schema: joi.alternatives().try(listSchema, listCountSchema)
        },
        validate: {
            query: schema.api.pagination
        }
    }
});
