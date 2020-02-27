'use strict';

const boom = require('boom');
const schema = require('screwdriver-data-schema');

module.exports = () => ({
    method: 'PUT',
    path: '/builds/{id}/steps/{name}',
    config: {
        description: 'Update a step for a build',
        notes: 'Writes a step record',
        tags: ['api', 'builds', 'steps'],
        auth: {
            strategies: ['token'],
            scope: ['build', 'temporal']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const stepFactory = request.server.app.stepFactory;
            const buildId = request.params.id;
            const stepName = request.params.name;
            const buildIdCred = request.auth.credentials.username;

            if (buildId !== buildIdCred) {
                return reply(boom.forbidden(`Credential only valid for ${buildIdCred}`));
            }

            const now = (new Date()).toISOString();

            // Check if step model exists
            return stepFactory.get({ buildId, name: stepName })
                .then((step) => {
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
                .then(updatedStep => reply(updatedStep).code(200))
                .catch(err => reply(boom.boomify(err)));
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
