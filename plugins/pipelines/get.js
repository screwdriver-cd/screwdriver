'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.pipeline.get;
const idSchema = schema.models.pipeline.base.extract('id');

/**
 * Get a pipeline when the current user is an explicitly registered admin from another SCM context.
 *
 * @param {Object} credentials            Request credentials
 * @param {String} pipelineId             Target pipeline ID
 * @param {Object} app                    Server app object
 * @return {Promise<Object|null>}          Pipeline when access is allowed, otherwise null
 */
async function canAccessPipelineForScmMigration(credentials, pipelineId, app) {
    const { username, scmContext, scope } = credentials;
    const { pipelineFactory, userFactory } = app;

    if (!scope.includes('user')) {
        return null;
    }

    const [pipeline, user] = await Promise.all([
        pipelineFactory.get(pipelineId),
        userFactory.get({ username, scmContext })
    ]);

    if (!pipeline || !user) {
        return null;
    }

    const isDifferentScm = user.scmContext !== pipeline.scmContext;
    const isExplicitAdmin = (pipeline.adminUserIds || []).includes(user.id);

    return isDifferentScm && isExplicitAdmin ? pipeline : null;
}

module.exports = () => ({
    method: 'GET',
    path: '/pipelines/{id}',
    options: {
        description: 'Get a single pipeline',
        notes: 'Returns a pipeline record',
        tags: ['api', 'pipelines'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build', 'pipeline']
        },
        plugins: {
            authorization: {
                permission: 'read'
            }
        },

        handler: async (request, h) => {
            const { canAccessPipeline } = request.server.plugins.pipelines;
            const { credentials } = request.auth;
            const pipelineId = request.params.id;
            let pipeline;

            try {
                pipeline = await canAccessPipeline(credentials, pipelineId, 'pull', request.server.app);
            } catch (err) {
                if (!err.isBoom || err.output.statusCode !== 403) {
                    throw err;
                }

                pipeline = await canAccessPipelineForScmMigration(credentials, pipelineId, request.server.app);

                if (!pipeline) {
                    throw err;
                }
            }

            if (!pipeline) {
                throw boom.notFound('Pipeline does not exist');
            }

            return h.response(pipeline.toJson());
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
