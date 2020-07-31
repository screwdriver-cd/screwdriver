'use strict';

const boom = require('@hapi/boom');
const joi = require('@hapi/joi');
const schema = require('screwdriver-data-schema');
const idSchema = joi.reach(schema.models.secret.base, 'id');

module.exports = () => ({
    method: 'PUT',
    path: '/secrets/{id}',
    config: {
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
        handler: (request, reply) => {
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

                            return reply(output).code(200);
                        });
                })
                .catch(err => reply(boom.boomify(err)));
        },
        validate: {
            params: {
                id: idSchema
            },
            payload: schema.models.secret.update
        }
    }
});
