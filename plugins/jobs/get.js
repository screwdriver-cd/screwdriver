'use strict';
const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.job.get;
const idSchema = joi.reach(schema.models.job.base, 'id');
const Model = require('screwdriver-models');

module.exports = (datastore) => ({
    method: 'GET',
    path: '/jobs/{id}',
    config: {
        description: 'Get a single job',
        notes: 'Returns a job record',
        tags: ['api', 'jobs'],
        handler: (request, reply) => {
            const Job = new Model.Job(datastore);

            Job.get(request.params.id, (err, data) => {
                if (err) {
                    return reply(boom.wrap(err));
                }
                if (!data) {
                    return reply(boom.notFound('Job does not exist'));
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
