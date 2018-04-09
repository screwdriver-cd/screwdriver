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
            const factory = request.server.app.buildFactory;
            const buildId = request.params.id;
            const buildIdCred = request.auth.credentials.username;
            let stepIndex = -1;

            if (buildId !== buildIdCred) {
                return reply(boom.forbidden(`Credential only valid for ${buildIdCred}`));
            }

            return factory.get(buildId)
                .then((build) => {
                    if (!build) {
                        throw boom.notFound('Build does not exist');
                    }
                    const steps = build.steps;
                    const now = (new Date()).toISOString();

                    stepIndex = steps.findIndex(step => step.name === request.params.name);

                    if (stepIndex === -1) {
                        throw boom.notFound('Step does not exist');
                    }

                    if (request.payload.code !== undefined) {
                        steps[stepIndex].code = request.payload.code;
                        steps[stepIndex].endTime = request.payload.endTime || now;
                    } else {
                        steps[stepIndex].startTime = request.payload.startTime || now;
                    }

                    build.steps = steps;

                    return build.update();
                })
                .then(build => reply(build.steps[stepIndex]).code(200))
                .catch(err => reply(boom.wrap(err)));
        },
        validate: {
            params: schema.api.loglines.params,
            payload: schema.models.build.updateStep
        }
    }
});
