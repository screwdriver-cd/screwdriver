'use strict';

const boom = require('@hapi/boom');
const joi = require('@hapi/joi');
const schema = require('screwdriver-data-schema');
const idSchema = joi.reach(schema.models.token.base, 'id');

module.exports = () => ({
    method: 'PUT',
    path: '/tokens/{id}/refresh',
    config: {
        description: 'Refresh a token',
        notes: 'Update the value of a token while preserving its other metadata',
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
        handler: (request, reply) => {
            const { tokenFactory } = request.server.app;
            const { credentials } = request.auth;
            const { canAccess } = request.server.plugins.tokens;

            return tokenFactory
                .get(request.params.id)
                .then(token => {
                    if (!token) {
                        throw boom.notFound('Token does not exist');
                    }

                    return canAccess(credentials, token)
                        .then(() => token.refresh())
                        .then(() => reply(token.toJson()).code(200));
                })
                .catch(err => reply(boom.boomify(err)));
        },
        validate: {
            params: {
                id: idSchema
            }
        }
    }
});
