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
            const eventFactory = request.server.app.eventFactory;
            const stepFactory = request.server.app.stepFactory;

            return eventFactory.get(request.params.id)
                .then((event) => {
                    if (!event) {
                        throw boom.notFound('Event does not exist');
                    }

                    return event.getBuilds();
                })
                .then( (buildsModel) => {
                    return Promise.all(buildsModel.map((buildModel) => {
                        return stepFactory.list({
                            params: { buildId: buildModel.id },
                            sortBy: 'id',
                            sort: 'ascending'})
                        .then( (stepsModel) => {
                            // This if statement should be removed after enough time has passed since build.steps removed.
                            // Make orders of steps in completed builds sure,
                            // because steps in old builds in DB have the order not sorted.
                            if (buildModel.endTime) {
                                stepsModel.sort((a, b) =>
                                    new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
                                );
                            }

                            const steps = stepsModel.map(s => s.toJson());

                            return Object.assign(buildModel.toJson(), { steps });

                        })
                    }))
                    .then( builds => reply(builds) 
                )})
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
