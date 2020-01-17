'use strict';

const boom = require('boom');

module.exports = () => ({
    method: 'GET',
    path: '/builds/{id}/steps',
    config: {
        description: 'Get a step for a build',
        notes: 'Returns a step record',
        tags: ['api', 'builds', 'steps'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build', 'pipeline', '!guest', 'temporal']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const buildFactory = request.server.app.buildFactory;
            const buildIdCred = request.auth.credentials.username
                && request.auth.credentials.username.toString();
            const buildId = request.params.id && request.params.id.toString();
            const status = request.query.status;

            if (request.auth.credentials.scope.includes('temporal') && buildId !== buildIdCred) {
                return reply(boom.forbidden(`Credential only valid for build ${buildIdCred}`));
            }

            return buildFactory.get(buildId)
                .then((buildModel) => {
                    if (!buildModel) {
                        throw boom.notFound('Build does not exist');
                    }
                    let stepModel;

                    switch (status) {
                    case 'active':
                        stepModel = buildModel.steps.filter(
                            step => step.startTime && !step.endTime);
                        break;
                    case 'success':
                        stepModel = buildModel.steps.filter(
                            step => step.startTime && step.endTime && step.code === 0);
                        break;
                    case 'failure':
                        stepModel = buildModel.steps.filter(
                            step => step.startTime && step.endTime && step.code > 0);
                        break;
                    default:
                        stepModel = [];
                    }

                    return reply(stepModel);
                })
                .catch(err => reply(boom.boomify(err)));
        }
    }
});
