'use strict';

const boom = require('boom');
const joi = require('joi');
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
            scope: ['user', '!guest']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const { jobFactory, pipelineFactory, userFactory } = request.server.app;
            const id = request.params.id;
            const username = request.auth.credentials.username;
            const scmContext = request.auth.credentials.scmContext;

            return jobFactory.get(id)
                .then((job) => {
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

                        // ask the user for permissions on this repo
                        return user.getPermissions(pipeline.scmUri)
                            // check if user has push access
                            .then((permissions) => {
                                if (!permissions.push) {
                                    throw boom.unauthorized(`User ${username} `
                                        + 'does not have write permission for this repo');
                                }

                                Object.keys(request.payload).forEach((key) => {
                                    job[key] = request.payload[key];
                                });

                                return job.update();
                            });
                    });
                })
                .then(job => reply(job.toJson()).code(200))
                .catch(err => reply(boom.wrap(err)));
        },
        validate: {
            params: {
                id: idSchema
            },
            payload: schema.models.job.update
        }
    }
});
