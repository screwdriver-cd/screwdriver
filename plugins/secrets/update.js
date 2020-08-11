'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = schema.models.secret.base.extract('id');

module.exports = () => ({
    method: 'PUT',
    path: '/secrets/{id}',
    options: {
        description: 'Update a secret',
        notes: 'Update a specific secret',
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
        handler: async (request, h) => {
            const factory = request.server.app.secretFactory;
            const { credentials } = request.auth;
            const { canAccess } = request.server.plugins.secrets;

            return factory
                .get(request.params.id)
                .then(secret => {
                    if (!secret) {
                        throw boom.notFound('Secret does not exist');
                    }

                    // Make sure that user has permission before updating
                    return canAccess(credentials, secret, 'admin')
                        .then(() => {
                            Object.keys(request.payload).forEach(key => {
                                secret[key] = request.payload[key];
                            });

                            return secret.update();
                        })
                        .then(() => {
                            const output = secret.toJson();

                            delete output.value;

                            return h.response(output).code(200);
                        });
                })
                .catch(err => {
                    throw err;
                });
        },
        validate: {
            params: joi.object({
                id: idSchema
            }),
            payload: schema.models.secret.update
        }
    }
});
