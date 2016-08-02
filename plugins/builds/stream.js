'use strict';
const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = joi.reach(schema.models.build.base, 'id');
const Model = require('screwdriver-models');

module.exports = (server) => ({
    method: 'GET',
    path: '/builds/{id}/logs',
    config: {
        description: 'Get logs for a build',
        notes: 'Streams logs',
        tags: ['api', 'builds'],
        auth: {
            strategies: ['token', 'session'],
            scope: ['user']
        },
        handler: (request, reply) => {
            const Build = new Model.Build(
                server.settings.app.datastore,
                server.settings.app.executor
            );
            const id = request.params.id;

            // eslint-disable-next-line consistent-return
            Build.get(id, (err, data) => {
                if (err) {
                    return reply(boom.wrap(err));
                }
                if (!data) {
                    return reply(boom.notFound(`Build ${id} does not exist.`));
                }
                Build.stream({
                    buildId: id
                }, (e, stream) => {
                    if (e) {
                        return reply(boom.wrap(e));
                    }

                    return reply(stream);
                });
            });
        },
        validate: {
            params: {
                id: idSchema
            }
        }
    }
});
