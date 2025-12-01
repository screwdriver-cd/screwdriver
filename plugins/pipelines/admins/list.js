'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const userListSchema = joi.array().items(schema.models.user.get).label('List of users');
const pipelineIdSchema = schema.models.pipeline.base.extract('id');

/**
 * @typedef {import('screwdriver-models/lib/pipeline')} Pipeline
 * @typedef {import('screwdriver-models/lib/user')} User
 * @typedef {import('screwdriver-models/lib/userFactory')} UserFactory
 */

/**
 * Retrieves the full user objects for all enabled administrators associated with a pipeline
 * based on the pipeline SCM context.
 *
 * This function first extracts a list of usernames that are explicitly set as 'true'
 * in the pipeline's 'admins' object. It then uses the provided user factory's 'list' method
 * to fetch the detailed user objects for these usernames from the pipeline SCM context.
 *
 * @param {Pipeline}    pipeline    The pipeline model object containing 'admins' and 'scmContext'.
 * @param {UserFactory} userFactory User Factory.
 * @returns {Promise<User[]>} A promise that resolves to an array of User objects for the
 * enabled pipeline administrators.
 */
function getAdminUsersFromPipelineSCMContext(pipeline, userFactory) {
    const { admins, scmContext } = pipeline;
    const adminUserNames = [];

    for (const username of Object.keys(admins)) {
        if (admins[username]) {
            adminUserNames.push(username);
        }
    }

    const listConfig = {
        params: {
            username: adminUserNames,
            scmContext
        }
    };

    return userFactory.list(listConfig);
}

/**
 * Retrieves the full user objects for administrators associated with a pipeline
 * who belong to a different SCM Context than the pipeline itself.
 *
 * This function uses a list of admin user IDs and the pipeline's SCM context
 * to fetch detailed user objects. It then filters the results, returning only
 * those users whose own registered SCM context does NOT match the pipeline's SCM context.
 *
 * @param {Pipeline} pipeline - The pipeline model object containing 'adminUserIds' (array of user IDs)
 * and 'scmContext' (the SCM context of the pipeline).
 * @param {UserFactory} userFactory - User Factory.
 * @returns {Promise<User[]>} A promise that resolves to an array of User objects
 * whose registered SCM context differs from the pipeline's context.
 */
function getAdminUsersFromOtherSCMContext(pipeline, userFactory) {
    const { scmContext } = pipeline;
    const adminUserIds = pipeline.adminUserIds ? pipeline.adminUserIds : [];

    const listConfig = {
        params: {
            id: adminUserIds
        }
    };

    return userFactory.list(listConfig).then(adminUsers => {
        return adminUsers.filter(user => user.scmContext !== scmContext);
    });
}

module.exports = () => ({
    method: 'GET',
    path: '/pipelines/{id}/admins',
    options: {
        description: 'Get all admin users for a given pipeline',
        notes: 'Returns all admin users for a given pipeline',
        tags: ['api', 'pipelines', 'admins'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'admin']
        },

        handler: async (request, h) => {
            const { pipelineFactory, userFactory } = request.server.app;

            return pipelineFactory
                .get(request.params.id)
                .then(pipeline => {
                    if (!pipeline) {
                        throw boom.notFound('Pipeline does not exist');
                    }

                    return Promise.all([
                        getAdminUsersFromPipelineSCMContext(pipeline, userFactory),
                        getAdminUsersFromOtherSCMContext(pipeline, userFactory)
                    ]);
                })
                .then(([adminUsersFromPipelineSCMContext, adminUsersFromOtherSCMContext]) => {
                    return [...adminUsersFromPipelineSCMContext, ...adminUsersFromOtherSCMContext];
                })
                .then(adminUsers =>
                    h.response(
                        adminUsers.map(user => {
                            const output = user.toJson();

                            delete output.token;
                            delete output.settings;

                            return output;
                        })
                    )
                )
                .catch(err => {
                    throw err;
                });
        },
        response: {
            schema: userListSchema
        },
        validate: {
            params: joi.object({
                id: pipelineIdSchema
            })
        }
    }
});
