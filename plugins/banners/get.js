'use strict';

const boom = require('boom');
const joi = require('joi');
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
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const bannerFactory = request.server.app.bannerFactory;
            const id = request.params.id;

            return bannerFactory.get(id)
                .then((banner) => {
                    if (!banner) {
                        throw boom.notFound(`Banner ${id} does not exist`);
                    }

                    return reply(banner.toJson());
                })
                .catch(err => reply(boom.wrap(err)));
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
