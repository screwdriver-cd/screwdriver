'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = joi.reach(schema.models.banner.base, 'id');

module.exports = () => ({
    method: 'PUT',
    path: '/banner/{id}',
    config: {
        description: 'Update a banner',
        notes: 'Update a banner',
        tags: ['api', 'banner'],
        auth: {
            strategies: ['token'],
            scope: ['user']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const bannerFactory = request.server.app.bannerFactory;
            const id = request.params.id; // id of banner to update

            return bannerFactory.get(id)
                .then((banner) => {
                    if (!banner) {
                        throw boom.notFound('Banner does not exist');
                    }

                    Object.keys(request.payload).forEach((key) => {
                        banner[key] = request.payload[key];
                    });

                    return banner.update();
                })
                .catch(err => reply(boom.wrap(err)));
        },
        validate: {
            params: {
                id: idSchema
            },
            payload: schema.models.banner.update
        }
    }
});
