'use strict';

const boom = require('@hapi/boom');
const Joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.banner.get;
const idSchema = schema.models.banner.base.extract('id');

module.exports = () => ({
    method: 'GET',
    path: '/banners/{id}',
    options: {
        description: 'Get a single banner',
        notes: 'Return a banner record',
        tags: ['api', 'banners'],
        handler: (request, h) => {
            const { bannerFactory } = request.server.app;
            const { id } = request.params;

            return bannerFactory
                .get(id)
                .then(banner => {
                    if (!banner) {
                        throw boom.notFound(`Banner ${id} does not exist`);
                    }

                    return h.response(banner.toJson());
                })
                .catch(err => h.response(boom.boomify(err)));
        },
        response: {
            schema: getSchema
        },
        validate: {
            params: Joi.object({
                id: idSchema
            })
        }
    }
});
