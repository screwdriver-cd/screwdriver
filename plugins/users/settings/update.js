'use strict';

const boom = require('@hapi/boom');
const schema = require('screwdriver-data-schema');
const updateSchema = schema.models.user.base.extract('settings');

module.exports = () => ({
    method: 'PUT',
    path: '/users/settings',
    options: {
        description: 'Update user settings',
        notes: 'Update user settings',
        tags: ['api', 'users'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest']
        },

        handler: async (request, h) => {
            const { userFactory } = request.server.app;
            const { scmContext, username } = request.auth.credentials;
            const { settings } = request.payload;
            const user = await userFactory.get({ username, scmContext });

            if (!user) {
                throw boom.notFound('User does not exist');
            }

            return user.updateSettings(settings).then(results => {
                return h.response(results).code(200);
            });
        },
        response: {
            schema: updateSchema
        }
    }
});
