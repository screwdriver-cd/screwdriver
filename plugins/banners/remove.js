'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = joi.reach(schema.models.banner.base, 'id');

module.exports = () => ({
    method: 'DELETE',
    path: '/banners/{id}',
    config: {
        description: 'Delete a banner',
        notes: 'Delete a specific banner and return null if success',
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
            const id = request.params.id; // id of banner to delete

            return Promise.all([
                bannerFactory.get({ id })
            ])
                .then(([banner]) => {
                    if (!banner || banner === null) {
                        throw boom.notFound(`Banner ${id} does not exist`);
                    }

                    Object.assign(banner, request.payload);

                    return banner.remove()
                        .then(() => reply().code(204));
                })
                .catch(err => reply(boom.wrap(err)));
        },
        validate: {
            params: {
                id: idSchema
            }
        }
    }
});
