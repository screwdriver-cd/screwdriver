'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = schema.models.user.base.extract('id');
const getSchema = schema.models.user.get;

module.exports = () => ({
    method: 'GET',
    path: '/users/{id}/settings',
    options: {
        description: 'Get user settings',
        notes: 'Returns user settings record',
        tags: ['api', 'users'],
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
            const { userFactory } = request.server.app;

            return userFactory
                .get(request.params.id)
                .then(user => {
                    if (!user) {
                        throw boom.notFound('User does not exist');
                    }
                    const userSettings = user.getSettings();

                    return h.response(userSettings);
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
