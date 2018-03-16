'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi.array().items(schema.models.secret.get).label('List of secrets');

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
            const pipelineFactory = request.server.app.pipelineFactory;
            const credentials = request.auth.credentials;
            const canAccess = request.server.plugins.secrets.canAccess;

            return pipelineFactory.get(request.params.id)
                .then((pipeline) => {
                    if (!pipeline) {
                        throw boom.notFound('Pipeline does not exist');
                    }

                    return pipeline.secrets;
                })
                .then((secrets) => {
                    if (secrets.length === 0) {
                        return reply([]);
                    }

                    return canAccess(credentials, secrets[0], 'push')
                        .then(() => reply(secrets.map((s) => {
                            const output = s.toJson();

                            delete output.value;

                            return output;
                        })));
                })
                .catch(err => reply(boom.wrap(err)));
        },
        response: {
            schema: listSchema
        }
    }
});
