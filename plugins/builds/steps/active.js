'use strict';

const boom = require('boom');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.build.getStep;

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

            if (status !== 'active') {
                return reply(boom.forbidden('Only status active is allowed'));
            }

            if (request.auth.credentials.scope.includes('temporal') && buildId !== buildIdCred) {
                return reply(boom.forbidden(`Credential only valid for build ${buildIdCred}`));
            }

            return buildFactory.get(buildId)
                .then((buildModel) => {
                    if (!buildModel) {
                        throw boom.notFound('Build does not exist');
                    }
                    const stepModel = buildModel.steps.find(
                        step => step.startTime && !step.endTime);

                    if (!stepModel) {
                        throw boom.notFound('Active step does not exist');
                    }

                    return reply(stepModel);
                })
                .catch(err => reply(boom.boomify(err)));
        },
        response: {
            schema: getSchema
        }
    }
});
