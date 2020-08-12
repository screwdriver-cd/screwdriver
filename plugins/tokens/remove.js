'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = schema.models.token.base.extract('id');

module.exports = () => ({
    method: 'DELETE',
    path: '/tokens/{id}',
    options: {
        description: 'Remove a single token',
        notes: 'Returns null if successful',
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
            const { canAccess } = request.server.plugins.tokens;
            const { credentials } = request.auth;

            // Get the token first
            return tokenFactory
                .get(request.params.id)
                .then(token => {
                    if (!token) {
                        throw boom.notFound('Token does not exist.');
                    }

                    // Check that the user is deleting their own token
                    return canAccess(credentials, token, request.server.app).then(() => token.remove());
                })
                .then(() => h.response().code(204))
                .catch(err => {
                    throw err;
                });
        },
        validate: {
            params: joi.object({
                id: idSchema
            })
        }
    }
});
