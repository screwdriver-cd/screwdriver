'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.banner.get;
const idSchema = joi.reach(schema.models.banner.base, 'id');

module.exports = () => ({
    method: 'GET',
    path: '/banner/{id}',
    config: {
        description: 'Get a single banner',
        notes: 'Return a banner record',
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

            return bannerFactory.get(request.params.id)
                .then((banner) => {
                    if (!banner || banner === null) {
                        throw boom.notFound('Banner does not exist');
                    }

                    // console.log('only here if banner exist');

                    return reply(banner.map(c => c.toJson()));
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
