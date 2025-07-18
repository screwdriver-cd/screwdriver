'use strict';

const urlLib = require('url');
const boom = require('@hapi/boom');
const hoek = require('@hapi/hoek');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.event.get;
const idSchema = schema.models.event.base.extract('id');
const { deriveEventStatusFromBuildStatuses } = require('../builds/helper/updateBuild');

module.exports = () => ({
    method: 'PUT',
    path: '/events/{id}/stop',
    options: {
        description: 'Stop all builds in an event',
        notes: 'Stop all builds in a specific event',
        tags: ['api', 'events'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest', 'pipeline']
        },

        handler: async (request, h) => {
            const { eventFactory, pipelineFactory, userFactory } = request.server.app;
            const { username, scmContext, scmUserId } = request.auth.credentials;
            const { isValidToken } = request.server.plugins.pipelines;
            const eventId = request.params.id;
            const { updateAdmins } = request.server.plugins.events;

            const event = await eventFactory.get(eventId);

            // Check if event exists
            if (!event) {
                throw boom.notFound(`Event ${eventId} does not exist`);
            }

            // Fetch the pipeline and user models
            const [pipeline, user] = await Promise.all([
                pipelineFactory.get(event.pipelineId),
                userFactory.get({ username, scmContext })
            ]);

            // In pipeline scope, check if the token is allowed to the pipeline
            if (!isValidToken(pipeline.id, request.auth.credentials)) {
                throw boom.unauthorized('Token does not have permission to this pipeline');
            }

            // Check permissions
            let permissions;

            try {
                permissions = await user.getPermissions(pipeline.scmUri);
            } catch (err) {
                if (err.statusCode === 403 && pipeline.scmRepo && pipeline.scmRepo.private) {
                    throw boom.notFound();
                }
                throw boom.boomify(err, { statusCode: err.statusCode });
            }

            const adminDetails = request.server.plugins.banners.screwdriverAdminDetails(
                username,
                scmContext,
                scmUserId
            );
            const isPrOwner = hoek.reach(event, 'commit.author.username') === username;

            // PR author should be able to stop their own PR event
            // Screwdriver admin can also stop events
            if (!((event.prNum && isPrOwner) || adminDetails.isAdmin)) {
                // Check permissions and update user in admins list
                await updateAdmins({
                    permissions,
                    pipeline,
                    user
                });
            }

            // User has good permissions, get event builds
            const builds = await event.getBuilds();
            const toUpdate = [];
            const updatedBuilds = [];

            // Update endtime and stop running builds
            // Note: COLLAPSED builds will never run
            builds.forEach(b => {
                if (['CREATED', 'RUNNING', 'QUEUED', 'BLOCKED', 'FROZEN'].includes(b.status)) {
                    if (b.status === 'RUNNING') {
                        b.endTime = new Date().toISOString();
                    }
                    b.status = 'ABORTED';
                    b.statusMessage = `Aborted by ${username}`;

                    toUpdate.push(b.update());
                } else {
                    updatedBuilds.push(b);
                }
            });
            updatedBuilds.push(...(await Promise.all(toUpdate)));

            const newEventStatus = deriveEventStatusFromBuildStatuses(updatedBuilds);

            if (newEventStatus && event.status !== newEventStatus) {
                event.status = newEventStatus;
                await event.update();
            }

            // everything succeeded, inform the user
            const location = urlLib.format({
                host: request.headers.host,
                port: request.headers.port,
                protocol: request.server.info.protocol,
                pathname: `${request.path}/${event.id}`
            });

            return h.response(event.toJson()).header('Location', location).code(200);
        },
        response: {
            schema: getSchema
        },
        validate: {
            params: joi.object({
                id: idSchema
            })
        }
    }
});
