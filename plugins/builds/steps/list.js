'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi
    .array()
    .items(schema.models.build.getStep)
    .label('List of steps');

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
            const { stepFactory } = request.server.app;
            const buildIdCred = request.auth.credentials.username && request.auth.credentials.username.toString();
            const buildId = request.params.id && request.params.id.toString();
            const { status } = request.query;

            if (request.auth.credentials.scope.includes('temporal') && buildId !== buildIdCred) {
                return reply(boom.forbidden(`Credential only valid for build ${buildIdCred}`));
            }

            return stepFactory
                .list({
                    params: { buildId },
                    sortBy: 'id',
                    sort: 'ascending'
                })
                .then(steps => {
                    if (steps.length <= 0) {
                        throw boom.notFound('Build does not exist');
                    }
                    let stepModel;

                    switch (status) {
                        case 'active':
                            stepModel = steps.filter(step => step.startTime && !step.endTime);
                            break;
                        case 'success':
                            stepModel = steps.filter(step => step.startTime && step.endTime && step.code === 0);
                            break;
                        case 'failure':
                            stepModel = steps.filter(step => step.startTime && step.endTime && step.code > 0);
                            break;
                        default:
                            stepModel = [].concat(steps);
                    }

                    return reply(stepModel.map(step => step.toJson()));
                })
                .catch(err => reply(boom.boomify(err)));
        },
        response: {
            schema: listSchema
        }
    }
});
