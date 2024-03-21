'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.stage.get;
const idSchema = schema.models.stage.base.extract('id');

module.exports = () => ({
    method: 'GET',
    path: '/stages/{id}',
    options: {
        description: 'Get a single stage',
        notes: 'Returns a stage record',
        tags: ['api', 'stages'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build', 'pipeline']
        },

        handler: async (request, h) => {
            const { stageFactory } = request.server.app;

            return stageFactory
                .get(request.params.id)
                .then(model => {
                    if (!model) {
                        throw boom.notFound(`Stage ${request.params.id} does not exist`);
                    }

                    return h.response(model.toJson());
                })
                .catch(err => {
                    throw err;
                });
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
