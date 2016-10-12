'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.secret.get;
const idSchema = joi.reach(schema.models.secret.base, 'id');

module.exports = () => ({
    method: 'GET',
    path: '/secrets/{id}',
    config: {
        description: 'Get a single secret',
        notes: 'Returns a secret record',
        tags: ['api', 'secrets'],
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
            const secretFactory = request.server.app.secretFactory;
            const credentials = request.auth.credentials;
            const canAccess = request.server.plugins.secrets.canAccess;

            return secretFactory.get(request.params.id)
                .then((secret) => {
                    if (!secret) {
                        throw boom.notFound('Secret does not exist');
                    }

                    return canAccess(credentials, secret, 'push').then((showSecret) => {
                        const output = secret.toJson();

                        if (!showSecret) {
                            delete output.value;
                        }

                        return reply(output);
                    });
                })
                .catch(err => reply(boom.wrap(err)));
        },
        response: {
            schema: getSchema
        },
        validate: {
            params: {
                id: idSchema
            }
        }
    }
});
