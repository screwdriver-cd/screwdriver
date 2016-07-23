'use strict';
const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.pipeline.get;
const idSchema = joi.reach(schema.models.pipeline.base, 'id');
const Model = require('screwdriver-models');

module.exports = (datastore) => ({
    method: 'GET',
    path: '/pipelines/{id}',
    config: {
        description: 'Get a single pipeline',
        notes: 'Returns a pipeline record',
        tags: ['api', 'pipelines'],
        handler: (request, reply) => {
            const Pipeline = new Model.Pipeline(datastore);

            Pipeline.get(request.params.id, (err, data) => {
                if (err) {
                    return reply(boom.wrap(err));
                }
                if (!data) {
                    return reply(boom.notFound('Pipeline does not exist'));
                }

                return reply(data);
            });
        },
        response: {
            schema: getSchema
        },
        validate: {
            params: {
                id: idSchema
            }
        }
    }
});
