'use strict';
const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.platform.get;
const idSchema = joi.reach(schema.models.platform.base, 'id');
const Model = require('screwdriver-models');

module.exports = (datastore) => ({
    method: 'GET',
    path: '/platforms/{id}',
    config: {
        description: 'Get a single platform',
        notes: 'Returns a platform record',
        tags: ['api', 'platforms'],
        handler: (request, reply) => {
            const Platform = new Model.Platform(datastore);
            const id = request.params.id;

            Platform.get(id, (err, data) => {
                if (err) {
                    return reply(boom.wrap(err));
                }
                if (!data) {
                    return reply(boom.notFound(`Platform ${id} does not exist`));
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
