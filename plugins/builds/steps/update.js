'use strict';

const boom = require('@hapi/boom');
const schema = require('screwdriver-data-schema');

module.exports = () => ({
    method: 'PUT',
    path: '/builds/{id}/steps/{name}',
    options: {
        description: 'Update a step for a build',
        notes: 'Writes a step record',
        tags: ['api', 'builds', 'steps'],
        auth: {
            strategies: ['token'],
            scope: ['build', 'temporal']
        },

        handler: async (request, h) => {
            const { stepFactory } = request.server.app;
            const buildId = request.params.id;
            const stepName = request.params.name;
            const buildIdCred = request.auth.credentials.username;

            if (request.payload && request.payload.code !== undefined) {
                if (request.payload.code !== 0) {
                    request.log(['builds', buildId, 'steps', stepName], `Step failed. Received payload: ${JSON.stringify(request.payload)}`);
                }
            } 

            if (buildId !== buildIdCred) {
                return boom.forbidden(`Credential only valid for ${buildIdCred}`);
            }

            const now = new Date().toISOString();

            // Check if step model exists
            return stepFactory
                .get({ buildId, name: stepName })
                .then(step => {
                    if (!step) {
                        throw boom.notFound('Step does not exist');
                    }
                    // Update step model directly if it exists
                    if (request.payload.code !== undefined) {
                        step.code = request.payload.code;
                        step.endTime = request.payload.endTime || now;
                    } else if (request.payload.lines !== undefined) {
                        step.lines = request.payload.lines;
                    } else {
                        step.startTime = request.payload.startTime || now;
                    }

                    return step.update();
                })
                .then(updatedStep => h.response(updatedStep).code(200))
                .catch(err => {
                    throw err;
                });
        },
        response: {
            schema: schema.models.build.getStep
        },
        validate: {
            params: schema.api.loglines.params,
            payload: schema.models.build.updateStep
        }
    }
});
