'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.job.get;
const idSchema = joi.reach(schema.models.job.base, 'id');

module.exports = () => ({
    method: 'GET',
    path: '/jobs/{id}',
    config: {
        description: 'Get a single job',
        notes: 'Returns a job record',
        tags: ['api', 'jobs'],
        handler: (request, reply) => {
            const factory = request.server.app.jobFactory;

            return factory.get(request.params.id)
                .then((job) => {
                    if (!job) {
                        throw boom.notFound('Job does not exist');
                    }

                    return reply(job.toJson());
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
