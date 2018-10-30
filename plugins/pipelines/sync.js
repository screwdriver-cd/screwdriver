'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = joi.reach(schema.models.pipeline.base, 'id');

module.exports = () => ({
    method: 'POST',
    path: '/pipelines/{id}/sync',
    config: {
        description: 'Sync a pipeline',
        notes: 'Sync a specific pipeline',
        tags: ['api', 'pipelines'],
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
            const id = request.params.id;
            const pipelineFactory = request.server.app.pipelineFactory;
            const userFactory = request.server.app.userFactory;
            const username = request.auth.credentials.username;
            const scmContext = request.auth.credentials.scmContext;
            const isValidToken = request.server.plugins.pipelines.isValidToken;

            if (!isValidToken(id, request.auth.credentials)) {
                return reply(boom.unauthorized('Token does not have permission to this pipeline'));
            }

            // Fetch the pipeline and user models
            return Promise.all([
                pipelineFactory.get(id),
                userFactory.get({ username, scmContext })
            ]).then(([pipeline, user]) => {
                if (!pipeline) {
                    throw boom.notFound('Pipeline does not exist');
                }
                if (!user) {
                    throw boom.notFound(`User ${username} does not exist`);
                }

                // ask the user for permissions on this repo
                return user.getPermissions(pipeline.scmUri)
                    // check if user has push access
                    // eslint-disable-next-line consistent-return
                    .then((permissions) => {
                        if (!permissions.push) {
                            // the user who are not permitted is deleted from admins table
                            const newAdmins = pipeline.admins;

                            delete newAdmins[username];
                            // This is needed to make admins dirty and update db
                            pipeline.admins = newAdmins;

                            return pipeline.update()
                                .then(() => {
                                    throw boom.unauthorized(`User ${username} `
                                        + 'does not have push permission for this repo');
                                });
                        }
                    })
                    // user has good permissions, add the user as an admin
                    // eslint-disable-next-line consistent-return
                    .then(() => {
                        if (!pipeline.admins[username]) {
                            const newAdmins = pipeline.admins;

                            newAdmins[username] = true;
                            // This is needed to make admins dirty and update db
                            pipeline.admins = newAdmins;

                            return pipeline.update();
                        }
                    })
                    // user has good permissions, sync the pipeline
                    .then(() => pipeline.sync())
                    .then(() => reply().code(204));
            })
                .catch(err => reply(boom.boomify(err)));
        },
        validate: {
            params: {
                id: idSchema
            }
        }
    }
});
