/* eslint no-param-reassign: ["error", { "props": false }] */
'use strict';
const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = joi.reach(schema.models.job.base, 'id');

module.exports = () => ({
    method: 'PUT',
    path: '/builds/{id}',
    config: {
        description: 'Save a build',
        notes: 'Save a specific build',
        tags: ['api', 'builds'],
        auth: {
            strategies: ['token', 'session'],
            scope: ['user', 'build']
        },
        handler: (request, reply) => {
            const factory = request.server.app.buildFactory;
            const id = request.params.id;
            const desiredStatus = request.payload.status;
            const username = request.auth.credentials.username;
            const scope = request.auth.credentials.scope;
            const isBuild = scope.includes('build');

            if (isBuild && username !== id) {
                throw boom.forbidden(`Credential only valid for ${username}`);
            }

            return factory.get(id)
                .then(build => {
                    if (!build) {
                        throw boom.notFound(`Build ${id} does not exist`);
                    }

                    // Check build status
                    if (!['RUNNING', 'QUEUED'].includes(build.status)) {
                        throw boom.forbidden('Can only update RUNNING or QUEUED builds');
                    }

                    // Users can only mark a running or queued build as aborted
                    if (!isBuild) {
                        // Check desired status
                        if (desiredStatus !== 'ABORTED') {
                            throw boom.badRequest('Can only update builds to ABORTED');
                        }
                        // Check permission against the pipeline
                        // @TODO implement this
                    } else {
                        switch (desiredStatus) {
                        case 'SUCCESS':
                        case 'FAILURE':
                        case 'ABORTED':
                            build.meta = request.payload.meta || {};
                            build.endTime = (new Date()).toISOString();
                            break;
                        case 'RUNNING':
                            build.startTime = (new Date()).toISOString();
                            break;
                        default:
                            throw boom.badRequest(`Cannot update builds to ${desiredStatus}`);
                        }
                    }

                    // Everyone is able to update the status
                    build.status = desiredStatus;

                    // @TODO trigger next build in workflow

                    // Update the model in datastore
                    return build.update();
                })
                .then(build => reply(build.toJson()).code(200))
                .catch(err => reply(boom.wrap(err)));
        },
        validate: {
            params: {
                id: idSchema
            },
            payload: schema.models.build.update
        }
    }
});
