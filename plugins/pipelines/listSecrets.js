'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const secretListSchema = joi.array().items(schema.models.secret.get).label('List of secrets');
const pipelineIdSchema = schema.models.pipeline.base.extract('id');

module.exports = () => ({
    method: 'GET',
    path: '/pipelines/{id}/secrets',
    options: {
        description: 'Get all secrets secrets for a given pipelines',
        notes: 'Returns all secrets for a given pipeline',
        tags: ['api', 'pipelines', 'secrets'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'pipeline', '!guest']
        },

        handler: async (request, h) => {
            const { pipelineFactory } = request.server.app;
            const { credentials } = request.auth;
            const { canAccess } = request.server.plugins.secrets;

            return pipelineFactory
                .get(request.params.id)
                .then(pipeline => {
                    if (!pipeline) {
                        throw boom.notFound('Pipeline does not exist');
                    }

                    return pipeline.secrets;
                })
                .then(secrets => {
                    if (secrets.length === 0) {
                        return h.response([]);
                    }

                    return canAccess(credentials, secrets[0], 'push', request.server.app).then(() =>
                        h.response(
                            secrets.map(s => {
                                const output = s.toJson();

                                delete output.value;

                                return output;
                            })
                        )
                    );
                })
                .catch(err => {
                    throw err;
                });
        },
        response: {
            schema: secretListSchema
        },
        validate: {
            params: joi.object({
                id: pipelineIdSchema
            })
        }
    }
});
