'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');

const isAdminPlugin = {
    name: 'isAdmin',
    async register(server) {
        server.route({
            method: 'GET',
            path: '/isAdmin',
            config: {
                description: 'Check if a user is admin of a pipeline, event, or job',
                notes: 'Returns true or false',
                tags: ['api'],
                auth: {
                    strategies: ['token'],
                    scope: ['user']
                },
                plugins: {
                    'hapi-swagger': {
                        security: [{ token: [] }]
                    }
                },
                handler: async (request, h) =>
                    Promise.resolve()
                        .then(() => {
                            const { pipelineId, eventId, jobId } = request.query;

                            if (eventId) {
                                const { eventFactory } = request.server.app;

                                return eventFactory.get(eventId).then(e => e.pipelineId);
                            }
                            if (jobId) {
                                const { jobFactory } = request.server.app;

                                return jobFactory.get(jobId).then(j => j.pipelineId);
                            }

                            return pipelineId;
                        })
                        .then(pid => {
                            const { pipelineFactory } = request.server.app;
                            const { userFactory } = request.server.app;
                            const { username } = request.auth.credentials;
                            const { scmContext } = request.auth.credentials;

                            return Promise.all([
                                pipelineFactory.get(pid),
                                userFactory.get({ username, scmContext })
                            ]).then(([pipeline, user]) => {
                                if (!pipeline) {
                                    throw boom.notFound(`Pipeline ${pid} does not exist`);
                                }

                                // ask the user for permissions on this repo
                                return user
                                    .getPermissions(pipeline.scmUri)
                                    .then(permissions => h.response(permissions.admin));
                            });
                        })
                        .catch(err => h.response(boom.boomify(err))),
                validate: {
                    query: joi
                        .object()
                        .keys({
                            pipelineId: schema.models.pipeline.base.extract('id'),
                            eventId: schema.models.event.base.extract('id'),
                            jobId: schema.models.job.base.extract('id')
                        })
                        .max(1)
                        .min(1)
                }
            }
        });
    }
};

module.exports = isAdminPlugin;
