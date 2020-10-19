'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = joi.array().items(schema.models.token.get);
const pipelineIdSchema = schema.models.pipeline.base.extract('id');

module.exports = () => ({
    method: 'GET',
    path: '/pipelines/{id}/tokens',
    options: {
        description: 'List tokens for pipeline',
        notes: 'List tokens for a specific pipeline',
        tags: ['api', 'tokens'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest']
        },

        handler: async (request, h) => {
            const { pipelineFactory } = request.server.app;
            const { userFactory } = request.server.app;
            const { username } = request.auth.credentials;
            const { scmContext } = request.auth.credentials;

            return Promise.all([pipelineFactory.get(request.params.id), userFactory.get({ username, scmContext })])
                .then(([pipeline, user]) => {
                    if (!pipeline) {
                        throw boom.notFound('Pipeline does not exist');
                    }

                    if (!user) {
                        throw boom.notFound('User does not exist');
                    }

                    return user.getPermissions(pipeline.scmUri).then(permissions => {
                        if (!permissions.admin) {
                            throw boom.forbidden(`User ${username} is not an admin of this repo`);
                        }

                        return pipeline.tokens;
                    });
                })
                .then(tokens =>
                    h.response(
                        tokens.map(token => {
                            const output = token.toJson();

                            delete output.userId;
                            delete output.pipelineId;

                            return output;
                        })
                    )
                )
                .catch(err => {
                    throw err;
                });
        },
        response: {
            schema: getSchema
        },
        validate: {
            params: joi.object({
                id: pipelineIdSchema
            })
        }
    }
});
