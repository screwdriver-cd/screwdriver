'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = schema.models.pipeline.base.extract('id');
const logger = require('screwdriver-logger');
const { getScmUri } = require('../helper');

/**
 * Remove other pipeline admins who no longer have push access.
 * @param {Object} pipeline Pipeline being synced
 * @param {Object} userFactory Factory for looking up admin users
 * @param {String} scmUri Repository URI
 * @param {Object} user User requesting the sync
 */
async function pruneAdmins(pipeline, userFactory, scmUri, user) {
    const admins = { ...pipeline.admins };
    const usernames = Object.keys(admins).filter(username => admins[username] && username !== user.username);

    if (usernames.length === 0) {
        return;
    }

    const users = await userFactory.list({ params: { username: usernames, scmContext: pipeline.scmContext } });
    const usersByName = new Map(users.map(admin => [admin.username, admin]));
    const removedIds = new Set();

    await Promise.all(
        usernames.map(async username => {
            const admin = usersByName.get(username);

            if (admin && (await admin.getPermissions(scmUri)).push) {
                return;
            }

            delete admins[username];
            if (admin) {
                removedIds.add(admin.id);
            }
        })
    );

    pipeline.admins = admins;
    pipeline.adminUserIds = pipeline.adminUserIds.filter(id => !removedIds.has(id));
}

module.exports = () => ({
    method: 'POST',
    path: '/pipelines/{id}/sync',
    options: {
        description: 'Sync a pipeline',
        notes: 'Sync a specific pipeline',
        tags: ['api', 'pipelines'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest', 'pipeline']
        },
        plugins: {
            authorization: {
                permission: 'all'
            }
        },

        handler: async (request, h) => {
            const { id } = request.params;
            const { pipelineFactory, userFactory } = request.server.app;
            const { username, scmContext, scope } = request.auth.credentials;
            const { isValidToken } = request.server.plugins.pipelines;

            if (!isValidToken(id, request.auth.credentials)) {
                return boom.unauthorized('Token does not have permission to this pipeline');
            }

            // Fetch the pipeline and user models
            const [pipeline, user] = await Promise.all([
                pipelineFactory.get(id),
                userFactory.get({ username, scmContext })
            ]);

            if (!pipeline) {
                throw boom.notFound('Pipeline does not exist');
            }
            if (pipeline.state === 'DELETING') {
                throw boom.conflict('This pipeline is being deleted.');
            }
            if (!user) {
                throw boom.notFound(`User ${username} does not exist`);
            }
            // for mysql backward compatibility
            if (!pipeline.adminUserIds) {
                pipeline.adminUserIds = [];
            }

            // Use parent's scmUri if pipeline is child pipeline and using read-only SCM
            const scmUri = await getScmUri({ pipeline, pipelineFactory });
            let hasPushPermissions = false;
            let permissions;

            try {
                // Get user permissions
                permissions = await user.getPermissions(scmUri);
            } catch (error) {
                throw boom.boomify(error, { statusCode: error.statusCode });
            }

            if (permissions.archived === true) {
                throw boom.forbidden('Archived repositories cannot be used for this operation');
            }

            // check if user has push access
            if (!permissions.push) {
                // user is not permitted, delete from admins table
                const newAdmins = pipeline.admins;

                delete newAdmins[username];
                const newAdminUserIds = pipeline.adminUserIds.filter(adminUserId => adminUserId !== user.id);

                // This is needed to make admins dirty and update db
                pipeline.admins = newAdmins;
                pipeline.adminUserIds = newAdminUserIds;

                if (!scope.includes('admin')) {
                    await pipeline.update();

                    throw boom.forbidden(
                        `User ${user.getFullDisplayName()} does not have push permission for this repo`
                    );
                }
            } else {
                hasPushPermissions = true;
            }

            // user has good permissions, add the user as an admin
            if (!pipeline.admins[username] && hasPushPermissions) {
                const newAdmins = pipeline.admins;
                const newAdminUserIds = pipeline.adminUserIds;

                newAdmins[username] = true;
                if (!newAdminUserIds.includes(user.id)) {
                    newAdminUserIds.push(user.id);
                }

                // This is needed to make admins dirty and update db
                pipeline.admins = newAdmins;
                pipeline.adminUserIds = newAdminUserIds;
            }

            try {
                if (hasPushPermissions) {
                    await pruneAdmins(pipeline, userFactory, scmUri, user);
                }

                await pipeline.sync();

                return h.response().code(204);
            } catch (err) {
                logger.error(`Failed to sync pipeline:${pipeline.id}`, err);
                throw err;
            }
        },
        validate: {
            params: joi.object({
                id: idSchema
            })
        }
    }
});
