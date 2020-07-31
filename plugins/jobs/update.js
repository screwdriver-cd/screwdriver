'use strict';

const boom = require('@hapi/boom');
const joi = require('@hapi/joi');
const schema = require('screwdriver-data-schema');
const idSchema = joi.reach(schema.models.job.base, 'id');

module.exports = () => ({
    method: 'PUT',
    path: '/jobs/{id}',
    config: {
        description: 'Update a job',
        notes: 'Update a specific job',
        tags: ['api', 'jobs'],
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

                                    return job.update();
                                })
                        );
                    });
                })
                .then(job => reply(job.toJson()).code(200))
                .catch(err => reply(boom.boomify(err)));
        },
        validate: {
            params: {
                id: idSchema
            },
            payload: schema.models.job.update
        }
    }
});
