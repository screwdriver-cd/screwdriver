'use strict';

const joi = require('joi');
const boom = require('@hapi/boom');
const schema = require('screwdriver-data-schema');
const api = require('./request');
const { getUserPermissions, getScmUri } = require('../../helper');

const SCHEMA_SCOPE_PIPELINE_ID = schema.models.pipeline.base.extract('id');
const SCHEMA_SCOPE_NAME = joi.string().valid('events', 'jobs', 'pipelines').label('Scope Name');
const SCHEMA_SCOPE_CACHE_ID = joi.number().integer().positive().label('Event/Job/Pipeline ID');

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
        plugins: {
            authorization: {
                permission: 'write'
            }
        },

        handler: async (request, h) => {
            const { pipelineFactory, userFactory, jobFactory, eventFactory } = request.server.app;
            const { username, scmContext } = request.auth.credentials;
            const pipelineId = request.params.id;
            const { scope, cacheId } = request.query;
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

            // Use parent's scmUri if pipeline is child pipeline and using read-only SCM
            const scmUri = await getScmUri({ pipeline, pipelineFactory });

            // Check the user's permission
            await getUserPermissions({ user, scmUri, level: 'push' });

            // Ensure the cache resource (scope/cacheId) actually belongs to this pipeline.
            // The push permission above only authorizes {id}; without this check a caller could
            // delete another pipeline's cache by passing an unrelated cacheId.
            let resourcePipelineId = cacheId;

            if (scope === 'jobs') {
                const job = await jobFactory.get(cacheId);

                resourcePipelineId = job && job.pipelineId;
            } else if (scope === 'events') {
                const event = await eventFactory.get(cacheId);

                resourcePipelineId = event && event.pipelineId;
            }

            if (resourcePipelineId !== pipelineId) {
                throw boom.forbidden(`Cache ${scope}:${cacheId} does not belong to pipeline ${pipelineId}`);
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
