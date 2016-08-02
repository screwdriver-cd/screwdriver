'use strict';
const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = joi.reach(schema.models.pipeline.base, 'id');
const Model = require('screwdriver-models');

module.exports = (datastore) => ({
    method: 'PUT',
    path: '/pipelines/{id}',
    config: {
        description: 'Save a pipeline',
        notes: 'Save a specific pipeline',
        tags: ['api', 'pipelines'],
        auth: {
            strategies: ['token', 'session'],
            scope: ['user']
        },
        handler: (request, reply) => {
            const Pipeline = new Model.Pipeline(datastore);
            const id = request.params.id;
            const data = request.payload;
            const config = {
                id,
                data
            };

            Pipeline.update(config, (err, response) => {
                if (err) {
                    return reply(boom.wrap(err));
                }

                if (!response) {
                    return reply(boom.notFound(`Pipeline ${id} does not exist`));
                }

                return reply(response).code(200);
            });
        },
        validate: {
            params: {
                id: idSchema
            },
            payload: schema.models.pipeline.update
        }
    }
});
