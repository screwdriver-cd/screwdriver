'use strict';

const boom = require('@hapi/boom');
const schema = require('screwdriver-data-schema');
const logger = require('screwdriver-logger');
const getSchema = schema.models.user.base.extract('settings');

module.exports = () => ({
    method: 'GET',
    path: '/users/settings',
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
            const { scmContext, username } = request.auth.credentials;

            try {
                const user = await userFactory.get({ username, scmContext });

                if (!user) {
                    throw boom.notFound('User does not exist');
                }

                const userSettings = user.getSettings();

                return h.response(userSettings);
            } catch (err) {
                logger.info(err.message);
            }

            return Promise.resolve();
        },
        response: {
            schema: getSchema
        }
    }
});
