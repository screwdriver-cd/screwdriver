'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = schema.models.token.base.extract('id');

module.exports = () => ({
    method: 'PUT',
    path: '/tokens/{id}/refresh',
    options: {
        description: 'Refresh a token',
        notes: 'Update the value of a token while preserving its other metadata',
        tags: ['api', 'tokens'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest']
        },

        handler: async (request, h) => {
            const { tokenFactory } = request.server.app;
            const { credentials } = request.auth;
            const { canAccess } = request.server.plugins.tokens;

            return tokenFactory
                .get(request.params.id)
                .then(token => {
                    if (!token) {
                        throw boom.notFound('Token does not exist');
                    }

                    return canAccess(credentials, token, request.server.app)
                        .then(() => token.refresh())
                        .then(() => h.response(token.toJson()).code(200));
                })
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
