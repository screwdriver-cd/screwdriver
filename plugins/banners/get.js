'use strict';

const boom = require('@hapi/boom');
const joi = require('@hapi/joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.banner.get;
const idSchema = joi.reach(schema.models.banner.base, 'id');

module.exports = () => ({
    method: 'GET',
    path: '/banners/{id}',
    config: {
        description: 'Get a single banner',
        notes: 'Return a banner record',
        tags: ['api', 'banners'],
        handler: (request, reply) => {
            const { bannerFactory } = request.server.app;
            const { id } = request.params;

            return bannerFactory
                .get(id)
                .then(banner => {
                    if (!banner) {
                        throw boom.notFound(`Banner ${id} does not exist`);
                    }

                    return reply(banner.toJson());
                })
                .catch(err => reply(boom.boomify(err)));
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
