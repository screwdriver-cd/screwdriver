'use strict';
const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.build.get;
const idSchema = joi.reach(schema.models.build.base, 'id');
const Model = require('screwdriver-models');

module.exports = (server) => ({
    method: 'GET',
    path: '/builds/{id}',
    config: {
        description: 'Get a single build',
        notes: 'Returns a build record',
        tags: ['api', 'builds'],
        handler: (request, reply) => {
            const Build = new Model.Build(
                server.settings.app.datastore,
                server.settings.app.executor
            );

            Build.get(request.params.id, (err, data) => {
                if (err) {
                    return reply(boom.wrap(err));
                }
                if (!data) {
                    return reply(boom.notFound('Build does not exist'));
                }

                return reply(data);
            });
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
