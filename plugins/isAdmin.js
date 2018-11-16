'use strict';

const boom = require('boom');
// const joi = require('joi');
// const schema = require('screwdriver-data-schema');
// const querySchema = joi.object({
//     pipelineId: joi.reach(schema.models.pipeline.base, 'id'),
//     eventId: joi.reach(schema.models.event.base, 'id'),
//     jobId: joi.reach(schema.models.pipeline.job, 'id')
// }).max(1).min(1);

exports.register = (server, options, next) => {
    server.route({
        method: 'GET',
        path: '/isAdmin',
        config: {
            description: 'Check if a user is admin of a single pipeline',
            notes: 'Returns true or false',
            tags: ['api', 'pipelines'],
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
                Promise.resolve().then(() => {
                    const { pipelineId, eventId, jobId } = request.query;

                    if (eventId) {
                        const eventFactory = request.server.app.eventFactory;

                        return eventFactory.get(eventId).then(e => e.pipelineId);
                    }
                    if (jobId) {
                        const jobFactory = request.server.app.jobFactory;

                        return jobFactory.get(jobId).then(j => j.pipelineId);
                    }

                    return pipelineId;
                }).then((pid) => {
                    const pipelineFactory = request.server.app.pipelineFactory;
                    const userFactory = request.server.app.userFactory;
                    const username = request.auth.credentials.username;
                    const scmContext = request.auth.credentials.scmContext;

                    return Promise.all([
                        pipelineFactory.get(pid),
                        userFactory.get({ username, scmContext })
                    ])
                    // get the pipeline given its ID and the user
                        .then(([pipeline, user]) => {
                            if (!pipeline) {
                                throw boom.notFound(`Pipeline ${pid} does not exist`);
                            }

                            // ask the user for permissions on this repo
                            return user.getPermissions(pipeline.scmUri)
                                .then(permissions => reply(permissions.admin));
                        });
                }).catch(err => reply(boom.boomify(err)))
            // validate: {
            //     query: querySchema
            // }
        }
    });

    next();
};

exports.register.attributes = {
    name: 'isAdmin'
};
