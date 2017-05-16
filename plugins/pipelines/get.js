'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.pipeline.get;
const idSchema = joi.reach(schema.models.pipeline.base, 'id');

module.exports = () => ({
    method: 'GET',
    path: '/pipelines/{id}',
    config: {
        description: 'Get a single pipeline',
        notes: 'Returns a pipeline record',
        tags: ['api', 'pipelines'],
        handler: (request, reply) => {
            const factory = request.server.app.pipelineFactory;
            const credentials = request.auth.credentials;
            const canAccess = request.server.plugins.pipelines.canAccess;

            return factory.get(request.params.id)
                .then((pipeline) => {
                    if (!pipeline) {
                        throw boom.notFound('Pipeline does not exist');
                    }

                    return canAccess(credentials, pipeline, 'pull').then((hasAccess) => {
                        if (hasAccess) {
                            return reply(pipeline.toJson());
                        }
                        throw boom.notFound('Pipeline does not exist');
                    });
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
