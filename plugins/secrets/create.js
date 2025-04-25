'use strict';

const urlLib = require('url');
const boom = require('@hapi/boom');
const schema = require('screwdriver-data-schema');
const logger = require('screwdriver-logger');
const { getUserPermissions, getScmUri } = require('../helper');

module.exports = () => ({
    method: 'POST',
    path: '/secrets',
    options: {
        description: 'Create a new secret',
        notes: 'Create a specific secret',
        tags: ['api', 'secrets'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest', 'pipeline']
        },

        handler: async (request, h) => {
            const { pipelineFactory, secretFactory, userFactory } = request.server.app;
            const { username, scmContext } = request.auth.credentials;
            const { isValidToken } = request.server.plugins.pipelines;

            const pipeline = await pipelineFactory.get(request.payload.pipelineId);

            if (!pipeline) {
                throw boom.notFound(`Pipeline ${request.payload.pipelineId} does not exist`);
            }

            if (pipeline.state === 'DELETING') {
                throw boom.conflict('This pipeline is being deleted.');
            }

            // In pipeline scope, check if the token is allowed to the pipeline
            if (!isValidToken(pipeline.id, request.auth.credentials)) {
                throw boom.forbidden('Token does not have permission to this pipeline');
            }

            const user = await userFactory.get({ username, scmContext });

            if (!user) {
                throw boom.notFound(`User ${username} does not exist`);
            }

            // Use parent's scmUri if pipeline is child pipeline and using read-only SCM
            const scmUri = await getScmUri({ pipeline, pipelineFactory });

            // Check the user's permission
            await getUserPermissions({ user, scmUri });

            // check if secret already exists
            const secret = await secretFactory.get({
                pipelineId: request.payload.pipelineId,
                name: request.payload.name
            });

            // if secret already exists, reject
            if (secret) {
                throw boom.conflict(`Secret already exists with the ID: ${secret.id}`);
            }

            logger.info(
                `[Audit] user ${user.username}:${scmContext} creates the secret key:${request.payload.name} for pipelineId:${request.payload.pipelineId}.`
            );
            const newSecret = await secretFactory.create(request.payload);

            const location = urlLib.format({
                host: request.headers.host,
                port: request.headers.port,
                protocol: request.server.info.protocol,
                pathname: `${request.path}/${newSecret.id}`
            });
            const output = newSecret.toJson();

            delete output.value;

            return h.response(output).header('Location', location).code(201);
        },
        validate: {
            payload: schema.models.secret.create
        }
    }
});
