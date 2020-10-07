'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const updateSchema = schema.models.user.update;
const idSchema = schema.models.user.base.extract('id');

module.exports = () => ({
    method: 'PUT',
    path: '/users/{id}/settings',
    options: {
        description: 'Update user settings',
        notes: 'Update a specific users settings',
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
            const { username } = request.auth.credentials;
            const { settings } = request.payload;
            const user = await userFactory.get(request.params.id);

            if (!user) {
                throw boom.notFound('User does not exist');
            }

            if (user.username !== username) {
                throw boom.forbidden(`User ${username} cannot update user settings for user ${user.username}`);
            }

            return user.updateSettings(settings).then(results => {
                return h.response(results).code(200);
            });
        },
        response: {
            schema: updateSchema
        },
        validate: {
            params: joi.object({
                id: idSchema
            })
        }
    }
});
