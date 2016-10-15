'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = joi.reach(schema.models.pipeline.base, 'id');

module.exports = () => ({
    method: 'PUT',
    path: '/pipelines/{id}',
    config: {
        description: 'Save a pipeline',
        notes: 'Save a specific pipeline',
        tags: ['api', 'pipelines'],
        auth: {
            strategies: ['token', 'session'],
            scope: ['user']
        },
        handler: (request, reply) => {
            const factory = request.server.app.pipelineFactory;
            const id = request.params.id;

            return factory.get(id)
                .then((pipeline) => {
                    if (!pipeline) {
                        throw boom.notFound(`Pipeline ${id} does not exist`);
                    }

                    Object.keys(request.payload).forEach((key) => {
                        pipeline[key] = request.payload[key];
                    });

                    return pipeline.sync()
                        .then(() => reply(pipeline.toJson()).code(200));
                })
                .catch(err => reply(boom.wrap(err)));
        },
        validate: {
            params: {
                id: idSchema
            },
            payload: schema.models.pipeline.update
        }
    }
});
