'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const urlLib = require('url');
const pipelineIdSchema = schema.models.pipeline.base.extract('id');
const tokenCreateSchema = schema.models.token.create;

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
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: async (request, h) => {
            const { tokenFactory } = request.server.app;
            const { userFactory } = request.server.app;
            const { pipelineFactory } = request.server.app;
            const { username } = request.auth.credentials;
            const { scmContext } = request.auth.credentials;
            const pipelineId = request.params.id;

            return Promise.all([pipelineFactory.get(pipelineId), userFactory.get({ username, scmContext })]).then(
                ([pipeline, user]) => {
                    if (!pipeline) {
                        throw boom.notFound('Pipeline does not exist');
                    }

                    if (!user) {
                        throw boom.notFound(`User ${username} does not exist`);
                    }

                    // Check the user's permission and make sure the name is unique
                    return Promise.all([
                        user.getPermissions(pipeline.scmUri).then(permissions => {
                            if (!permissions.admin) {
                                throw boom.forbidden(`User ${username} is not an admin of this repo`);
                            }

                            return Promise.resolve();
                        }),
                        pipeline.tokens.then(tokens => {
                            const match = tokens && tokens.find(t => t.name === request.payload.name);

                            if (match) {
                                throw boom.conflict(`Token ${match.name} already exists`);
                            }

                            return Promise.resolve();
                        })
                    ])
                        .then(() =>
                            tokenFactory.create({
                                name: request.payload.name,
                                description: request.payload.description,
                                pipelineId
                            })
                        )
                        .then(token => {
                            const location = urlLib.format({
                                host: request.headers.host,
                                port: request.headers.port,
                                protocol: request.server.info.protocol,
                                pathname: `${request.path}/${token.id}`
                            });

                            return h
                                .response(token.toJson())
                                .header('Location', location)
                                .code(201);
                        })
                        .catch(err => {
                            throw err;
                        });
                }
            );
        },
        validate: {
            params: joi.object({
                id: pipelineIdSchema
            }),
            payload: tokenCreateSchema
        }
    }
});
