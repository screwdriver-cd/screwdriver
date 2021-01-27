'use strict';

const joi = require('joi');
const boom = require('@hapi/boom');
const schema = require('screwdriver-data-schema');
const api = require('./request');

const SCHEMA_SCOPE_PIPELINE_ID = schema.models.pipeline.base.extract('id');
const SCHEMA_SCOPE_NAME = joi
    .string()
    .valid('events', 'jobs', 'pipelines')
    .label('Scope Name');
const SCHEMA_SCOPE_CACHE_ID = joi
    .number()
    .integer()
    .positive()
    .label('Event/Job/Pipeline ID');

module.exports = () => ({
    method: 'DELETE',
    path: '/pipelines/{id}/caches',
    options: {
        description: 'API to delete cache using scope and id',
        notes: 'Deletes the entire cache folder for pipeline, job or event using its id',
        tags: ['api', 'events', 'jobs', 'pipelines', 'cache'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'pipeline', '!guest']
        },

        handler: async (request, h) => {
            const { pipelineFactory, userFactory } = request.server.app;
            const { username, scmContext } = request.auth.credentials;
            const pipelineId = request.params.id;
            const { isValidToken } = request.server.plugins.pipelines;

            if (!isValidToken(pipelineId, request.auth.credentials)) {
                throw boom.unauthorized('Token does not have permission to this pipeline');
            }

            const [pipeline, user] = await Promise.all([
                pipelineFactory.get(pipelineId),
                userFactory.get({ username, scmContext })
            ]);

            if (!pipeline) {
                throw boom.notFound('Pipeline does not exist');
            }
            if (!user) {
                throw boom.notFound(`User ${username} does not exist`);
            }

            const permissions = await user.getPermissions(pipeline.scmUri);

            if (!permissions.admin) {
                throw boom.forbidden(`User ${user.getFullDisplayName()} does not have permission to delete this cache`);
            }

            const res = await api.invoke(request);

            const statusCode = res.statusCode === 200 ? 204 : res.statusCode;

            return h.response(res).code(statusCode);
        },
        validate: {
            query: joi.object({
                scope: SCHEMA_SCOPE_NAME,
                cacheId: SCHEMA_SCOPE_CACHE_ID
            }),
            params: joi.object({
                id: SCHEMA_SCOPE_PIPELINE_ID
            })
        }
    }
});
