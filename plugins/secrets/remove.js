'use strict';

const boom = require('@hapi/boom');
const joi = require('@hapi/joi');
const schema = require('screwdriver-data-schema');
const idSchema = joi.reach(schema.models.secret.base, 'id');

module.exports = () => ({
    method: 'DELETE',
    path: '/secrets/{id}',
    config: {
        description: 'Remove a single secret',
        notes: 'Returns null if successful',
        tags: ['api', 'secrets'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest', 'pipeline']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const { secretFactory } = request.server.app;
            const { credentials } = request.auth;
            const { canAccess } = request.server.plugins.secrets;

            // Get the secret first
            return secretFactory
                .get(request.params.id)
                .then(secret => {
                    if (!secret) {
                        throw boom.notFound('Secret does not exist');
                    }

                    // Make sure that user has permission before deleting
                    return canAccess(credentials, secret, 'admin')
                        .then(() => secret.remove())
                        .then(() => reply().code(204));
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
