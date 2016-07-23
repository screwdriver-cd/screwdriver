'use strict';
const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = joi.reach(schema.models.platform.base, 'id');
const updateSchema = schema.models.platform.update;
const Model = require('screwdriver-models');

module.exports = (datastore) => ({
    method: 'PUT',
    path: '/platforms/{id}',
    config: {
        description: 'Update a platform',
        notes: 'Update a specific platform',
        tags: ['api', 'platforms'],
        auth: {
            strategies: ['token', 'session']
        },
        handler: (request, reply) => {
            const Platform = new Model.Platform(datastore);
            const id = request.params.id;
            const config = {
                id,
                data: request.payload
            };

            // eslint-disable-next-line consistent-return
            Platform.update(config, (err, response) => {
                if (err) {
                    return reply(boom.wrap(err));
                }
                if (!response) {
                    return reply(boom.notFound(`Platform ${id} does not exist`));
                }

                return reply(response).code(200);
            });
        },
        validate: {
            params: {
                id: idSchema
            },
            payload: updateSchema
        }
    }
});
