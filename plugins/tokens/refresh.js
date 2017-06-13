'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = joi.reach(schema.models.token.base, 'id');

module.exports = () => ({
    method: 'PUT',
    path: '/tokens/{id}/refresh',
    config: {
        description: 'Refresh a token',
        notes: 'Update the value of a token while preserving its other metadata',
        tags: ['api', 'secrets'],
        auth: {
            strategies: ['token', 'session'],
            scope: ['user']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const tokenFactory = request.server.app.tokenFactory;
            const credentials = request.auth.credentials;
            const canAccess = request.server.plugins.tokens.canAccess;

            return tokenFactory.get(request.params.id)
                .then((token) => {
                    if (!token) {
                        throw boom.notFound('Token does not exist');
                    }

                    return canAccess(credentials, token)
                        .then(() => token.refresh())
                        .then(() => {
                            const output = token.toJson();

                            delete output.hash;

                            return reply(output).code(200);
                        });
                })
                .catch(err => reply(boom.wrap(err)));
        },
        validate: {
            params: {
                id: idSchema
            }
        }
    }
});
