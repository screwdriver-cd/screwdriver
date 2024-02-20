'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi.array().items(schema.models.build.getStep).label('List of steps');
const idSchema = schema.models.build.base.extract('id');

module.exports = () => ({
    method: 'GET',
    path: '/builds/{id}/steps',
    options: {
        description: 'Get a step for a build',
        notes: 'Returns a step record',
        tags: ['api', 'builds', 'steps'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build', 'pipeline', '!guest', 'temporal']
        },

        handler: async (request, h) => {
            const { stepFactory } = request.server.app;
            const buildIdCred = request.auth.credentials.username && request.auth.credentials.username.toString();
            const buildId = request.params.id && request.params.id.toString();
            const { status } = request.query;

            if (request.auth.credentials.scope.includes('temporal') && buildId !== buildIdCred) {
                return boom.forbidden(`Credential only valid for build ${buildIdCred}`);
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

                    return h.response(stepModel.map(step => step.toJson()));
                })
                .catch(err => {
                    throw err;
                });
        },
        response: {
            schema: listSchema
        },
        validate: {
            params: joi.object({
                id: idSchema
            })
        }
    }
});
