'use strict';

const boom = require('@hapi/boom');
const joi = require('@hapi/joi');
const schema = require('screwdriver-data-schema');
const secretListSchema = joi
    .array()
    .items(schema.models.secret.get)
    .label('List of secrets');
const pipelineIdSchema = joi.reach(schema.models.pipeline.base, 'id');

module.exports = () => ({
    method: 'GET',
    path: '/pipelines/{id}/secrets',
    config: {
        description: 'Get all secrets secrets for a given pipelines',
        notes: 'Returns all secrets for a given pipeline',
        tags: ['api', 'pipelines', 'secrets'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
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
                        return reply([]);
                    }

                    return canAccess(credentials, secrets[0], 'push').then(() =>
                        reply(
                            secrets.map(s => {
                                const output = s.toJson();

                                delete output.value;

                                return output;
                            })
                        )
                    );
                })
                .catch(err => reply(boom.boomify(err)));
        },
        response: {
            schema: secretListSchema
        },
        validate: {
            params: {
                id: pipelineIdSchema
            }
        }
    }
});
