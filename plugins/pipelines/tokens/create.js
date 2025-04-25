'use strict';

const urlLib = require('url');
const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const logger = require('screwdriver-logger');
const pipelineIdSchema = schema.models.pipeline.base.extract('id');
const tokenCreateSchema = schema.models.token.create;
const { getUserPermissions, getScmUri } = require('../../helper');

module.exports = () => ({
    method: 'POST',
    path: '/pipelines/{id}/tokens',
    options: {
        description: 'Create a new token for pipeline',
        notes: 'Create a specific token for pipeline',
        tags: ['api', 'tokens'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest']
        },

        handler: async (request, h) => {
            const { pipelineFactory, tokenFactory, userFactory } = request.server.app;
            const { username, scmContext } = request.auth.credentials;
            const pipelineId = request.params.id;

            const [pipeline, user] = await Promise.all([
                pipelineFactory.get(pipelineId),
                userFactory.get({ username, scmContext })
            ]);

            if (!pipeline) {
                throw boom.notFound('Pipeline does not exist');
            }

            if (pipeline.state === 'DELETING') {
                throw boom.conflict('This pipeline is being deleted.');
            }

            if (!user) {
                throw boom.notFound(`User ${username} does not exist`);
            }

            // Use parent's scmUri if pipeline is child pipeline and using read-only SCM
            const scmUri = await getScmUri({ pipeline, pipelineFactory });

            // Check the user's permission
            await getUserPermissions({ user, scmUri });

            // Make sure the token name is unique
            const tokens = await pipeline.tokens;
            const match = tokens && tokens.find(t => t.name === request.payload.name);

            if (match) {
                throw boom.conflict(`Token ${match.name} already exists`);
            }

            logger.info(
                `[Audit] user ${username}:${scmContext} creates the token name:${request.payload.name} for pipelineId:${pipelineId}.`
            );
            const token = await tokenFactory.create({
                name: request.payload.name,
                description: request.payload.description,
                pipelineId
            });

            const location = urlLib.format({
                host: request.headers.host,
                port: request.headers.port,
                protocol: request.server.info.protocol,
                pathname: `${request.path}/${token.id}`
            });

            return h.response(token.toJson()).header('Location', location).code(201);
        },
        validate: {
            params: joi.object({
                id: pipelineIdSchema
            }),
            payload: tokenCreateSchema
        }
    }
});
