'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const buildListSchema = joi.array().items(schema.models.build.get).label('List of builds');
const eventIdSchema = joi.reach(schema.models.event.base, 'id');

module.exports = () => ({
    method: 'GET',
    path: '/events/{id}/builds',
    config: {
        description: 'Get builds for a given event',
        notes: 'Returns builds for a given event',
        tags: ['api', 'events', 'builds'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'pipeline']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const factory = request.server.app.eventFactory;

            return factory.get(request.params.id)
                .then((event) => {
                    if (!event) {
                        throw boom.notFound('Event does not exist');
                    }

                    return event.getBuilds();
                })
                .then(builds => reply(builds.map(b => b.toJson())))
                .catch(err => reply(boom.boomify(err)));
        },
        response: {
            schema: buildListSchema
        },
        validate: {
            params: {
                id: eventIdSchema
            }
        }
    }
});
