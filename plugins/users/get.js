'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const logger = require('screwdriver-logger');
const getSchema = schema.models.user.base.get;
const usernameSchema = schema.models.user.base.extract('username');
const scmContextSchema = schema.models.pipeline.base.extract('scmContext');

module.exports = () => ({
    method: 'GET',
    path: '/users/{username}',
    options: {
        description: 'Get an user by SCM username and SCM context',
        notes: 'Returns an user by SCM username and SCM context',
        tags: ['api', 'users'],
        auth: {
            strategies: ['token'],
            scope: ['admin', '!guest']
        },

        handler: async (request, h) => {
            const { username } = request.params;
            const { userFactory } = request.server.app;
            const { scmContext, includeUserToken } = request.query;
            const { credentials } = request.auth;

            const user = await userFactory.get({
                username,
                scmContext
            });

            if (!user) {
                throw boom.notFound(`User ${username} does not exist for the scmContext ${scmContext}`);
            }

            if (includeUserToken) {
                logger.info(
                    `[Audit] User ${credentials.username}:${credentials.scmContext} requests ${username}:${scmContext}'s token.`
                );
                const profile = request.server.plugins.auth.generateProfile({
                    username: user.username,
                    scmContext: user.scmContext,
                    scope: ['user']
                });

                user.userToken = request.server.plugins.auth.generateToken(profile);
            }

            return h.response(user);
        },
        response: {
            schema: getSchema
        },
        validate: {
            params: joi.object({
                username: usernameSchema
            }),
            query: joi.object({
                scmContext: scmContextSchema.required(),
                includeUserToken: joi.boolean().optional()
            })
        }
    }
});
