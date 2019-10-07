'use strict';

const boom = require('boom');
const hoek = require('hoek');
const joi = require('joi');
const urlLib = require('url');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.event.get;
const idSchema = joi.reach(schema.models.event.base, 'id');

module.exports = () => ({
    method: 'PUT',
    path: '/events/{id}/stop',
    config: {
        description: 'Stop all builds in an event',
        notes: 'Stop all builds in a specific event',
        tags: ['api', 'events'],
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
            const eventFactory = request.server.app.eventFactory;
            const pipelineFactory = request.server.app.pipelineFactory;
            const userFactory = request.server.app.userFactory;
            const scmContext = request.auth.credentials.scmContext;
            const username = request.auth.credentials.username;
            const isValidToken = request.server.plugins.pipelines.isValidToken;
            const eventId = request.params.id;
            const updateAdmins = request.server.plugins.events.updateAdmins;

            return eventFactory.get(eventId)
                .then((event) => {
                    // Check if event exists
                    if (!event) {
                        throw boom.notFound(`Event ${eventId} does not exist`);
                    }

                    return Promise.all([
                        pipelineFactory.get(event.pipelineId),
                        userFactory.get({ username, scmContext })
                    ]).then(([pipeline, user]) => {
                        // In pipeline scope, check if the token is allowed to the pipeline
                        if (!isValidToken(pipeline.id, request.auth.credentials)) {
                            throw boom.unauthorized(
                                'Token does not have permission to this pipeline');
                        }

                        let permissions;

                        // Check permissions
                        return user.getPermissions(pipeline.scmUri)
                            .then((userPermissions) => {
                                const adminDetails = request.server.plugins.banners
                                    .screwdriverAdminDetails(username, scmContext);
                                const isPrOwner = hoek.reach(event,
                                    'commit.author.username') === username;

                                permissions = userPermissions;

                                // PR author should be able to stop their own PR event
                                // Screwdriver admin can also stop events
                                if ((event.prNum && isPrOwner) || adminDetails.isAdmin) {
                                    return Promise.resolve();
                                }

                                // Check permissions and update user in admins list
                                return updateAdmins({
                                    permissions,
                                    pipeline,
                                    username
                                });
                            });
                    // User has good permissions, get event builds
                    }).then(() => event.getBuilds().then((builds) => {
                        const toUpdate = [];

                        // Update endtime and stop running builds
                        // Note: COLLAPSED builds will never run
                        builds.forEach((b) => {
                            if (['CREATED', 'RUNNING', 'QUEUED', 'BLOCKED', 'FROZEN']
                                .includes(b.status)) {
                                if (b.status === 'RUNNING') {
                                    b.endTime = (new Date()).toISOString();
                                }
                                b.status = 'ABORTED';
                                b.statusMessage = `Aborted by ${username}`;

                                toUpdate.push(b.update());
                            }
                        });

                        return Promise.all(toUpdate);
                    })).then(() => {
                        // everything succeeded, inform the user
                        const location = urlLib.format({
                            host: request.headers.host,
                            port: request.headers.port,
                            protocol: request.server.info.protocol,
                            pathname: `${request.path}/${event.id}`
                        });

                        return reply(event.toJson()).header('Location', location).code(200);
                    });
                }).catch(err => reply(boom.boomify(err)));
        },
        response: {
            schema: getSchema
        },
        validate: {
            params: {
                id: idSchema
            }
        }
    }
});
