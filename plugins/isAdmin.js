'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');

exports.register = (server, options, next) => {
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
            handler: (request, reply) =>
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

                        return Promise.all([pipelineFactory.get(pid), userFactory.get({ username, scmContext })]).then(
                            ([pipeline, user]) => {
                                if (!pipeline) {
                                    throw boom.notFound(`Pipeline ${pid} does not exist`);
                                }

                                // ask the user for permissions on this repo
                                return user
                                    .getPermissions(pipeline.scmUri)
                                    .then(permissions => reply(permissions.admin));
                            }
                        );
                    })
                    .catch(err => reply(boom.boomify(err))),
            validate: {
                query: joi
                    .object()
                    .keys({
                        pipelineId: joi.reach(schema.models.pipeline.base, 'id'),
                        eventId: joi.reach(schema.models.event.base, 'id'),
                        jobId: joi.reach(schema.models.job.base, 'id')
                    })
                    .max(1)
                    .min(1)
            }
        }
    });

    next();
};

exports.register.attributes = {
    name: 'isAdmin'
};
