'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = schema.models.user.base.extract('id');
const getSchema = schema.models.user.base.extract('settings');

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

        handler: async (request, h) => {
            const { userFactory } = request.server.app;
            const user = await userFactory.get(request.params.id);

            if (!user) {
                throw boom.notFound('User does not exist');
            }
            const userSettings = user.getSettings();

            return h.response(userSettings);
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
