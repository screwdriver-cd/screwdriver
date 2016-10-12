'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi.array().items(schema.models.secret.get).label('List of secrets');

module.exports = () => ({
    method: 'GET',
    path: '/builds/{id}/secrets',
    config: {
        description: 'Get all secrets for a given build',
        notes: 'Returns all secrets for a given build',
        tags: ['api', 'builds', 'secrets'],
        auth: {
            strategies: ['token', 'session'],
            scope: ['user', 'build']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const factory = request.server.app.buildFactory;
            const credentials = request.auth.credentials;
            const canAccess = request.server.plugins.secrets.canAccess;

            return factory.get(request.params.id)
                .then((build) => {
                    if (!build) {
                        throw boom.notFound('Build does not exist');
                    }

                    return build.secrets;
                })
                .then((secrets) => {
                    if (secrets.length === 0) {
                        return reply([]);
                    }

                    return canAccess(credentials, secrets[0], 'push').then(showSecret =>
                        reply(secrets.map((s) => {
                            const output = s.toJson();

                            if (!showSecret) {
                                delete output.value;
                            }

                            return output;
                        }))
                    );
                })
                .catch(err => reply(boom.wrap(err)));
        },
        response: {
            schema: listSchema
        }
    }
});
