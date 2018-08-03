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
            scope: ['build']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const buildFactory = request.server.app.buildFactory;
            const stepFactory = request.server.app.stepFactory;
            const buildId = request.params.id;
            const stepName = request.params.name;
            const buildIdCred = request.auth.credentials.username;
            let stepIndex = -1;

            if (buildId !== buildIdCred) {
                return reply(boom.forbidden(`Credential only valid for ${buildIdCred}`));
            }

            // Make sure build exists
            return buildFactory.get(buildId)
                .then((build) => {
                    if (!build) {
                        throw boom.notFound('Build does not exist');
                    }
                    const now = (new Date()).toISOString();

                    // Check if step model exists
                    return stepFactory.get({ buildId, name: stepName })
                        .then((step) => {
                            if (!step) {
                                // Update build steps if no step model
                                const steps = build.steps;

                                stepIndex = steps.findIndex(s => s.name === stepName);

                                if (stepIndex === -1) {
                                    throw boom.notFound('Step does not exist');
                                }

                                if (request.payload.code !== undefined) {
                                    steps[stepIndex].code = request.payload.code;
                                    steps[stepIndex].endTime = request.payload.endTime || now;
                                } else if (request.payload.lines !== undefined) {
                                    steps[stepIndex].lines = request.payload.lines;
                                } else {
                                    steps[stepIndex].startTime = request.payload.startTime || now;
                                }

                                build.steps = steps;

                                return build.update()
                                    .then(b => b.steps[stepIndex]);
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
                        });
                })
                .then(updatedStep => reply(updatedStep).code(200))
                .catch(err => reply(boom.wrap(err)));
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
