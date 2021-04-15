'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = schema.models.job.base.extract('id');

module.exports = () => ({
    method: 'PUT',
    path: '/jobs/{id}',
    options: {
        description: 'Update a job',
        notes: 'Update a specific job',
        tags: ['api', 'jobs'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest', 'pipeline']
        },

        handler: async (request, h) => {
            const { jobFactory, pipelineFactory, userFactory } = request.server.app;
            const { id } = request.params;
            const { username } = request.auth.credentials;
            const { scmContext } = request.auth.credentials;
            const { isValidToken } = request.server.plugins.pipelines;

            return jobFactory
                .get(id)
                .then(job => {
                    if (!job) {
                        throw boom.notFound(`Job ${id} does not exist`);
                    }

                    return Promise.all([
                        pipelineFactory.get(job.pipelineId),
                        userFactory.get({ username, scmContext })
                    ]).then(([pipeline, user]) => {
                        if (!pipeline) {
                            throw boom.notFound('Pipeline does not exist');
                        }

                        // In pipeline scope, check if the token is allowed to the pipeline
                        if (!isValidToken(pipeline.id, request.auth.credentials)) {
                            throw boom.unauthorized('Token does not have permission to this pipeline');
                        }

                        // ask the user for permissions on this repo
                        return (
                            user
                                .getPermissions(pipeline.scmUri)
                                // check if user has push access
                                .then(permissions => {
                                    if (!permissions.push) {
                                        throw boom.forbidden(
                                            `User ${username} does not have write permission for this repo`
                                        );
                                    }

                                    Object.keys(request.payload).forEach(key => {
                                        job[key] = request.payload[key];
                                    });

                                    // Set stateChanger, stateChangeTime
                                    job.stateChanger = username;
                                    job.stateChangeTime = new Date().toISOString();

                                    return job.update();
                                })
                        );
                    });
                })
                .then(job => h.response(job.toJson()).code(200))
                .catch(err => {
                    throw err;
                });
        },
        validate: {
            params: joi.object({
                id: idSchema
            }),
            payload: schema.models.job.update
        }
    }
});
