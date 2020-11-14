'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.secret.get;
const idSchema = schema.models.secret.base.extract('id');

module.exports = () => ({
    method: 'GET',
    path: '/secrets/{id}',
    options: {
        description: 'Get a single secret',
        notes: 'Returns a secret record',
        tags: ['api', 'secrets'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build', '!guest']
        },

        handler: async (request, h) => {
            const { secretFactory } = request.server.app;
            const { credentials } = request.auth;
            const { canAccess } = request.server.plugins.secrets;

            return secretFactory
                .get(request.params.id)
                .then(secret => {
                    if (!secret) {
                        throw boom.notFound('Secret does not exist');
                    }

                    return canAccess(credentials, secret, 'push', request.server.app).then(showSecret => {
                        const output = secret.toJson();

                        if (!showSecret) {
                            delete output.value;
                        }

                        return h.response(output);
                    });
                })
                .catch(err => {
                    throw err;
                });
        },
        response: {
            schema: getSchema
        },
        validate: {
            params: joi.object({
                id: idSchema
            })
        }
    }
});
