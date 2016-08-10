'use strict';
const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi.array().items(schema.models.job.get).label('List of Jobs');

module.exports = (server) => ({
    method: 'GET',
    path: '/jobs',
    config: {
        description: 'Get jobs with pagination',
        notes: 'Returns all jobs records',
        tags: ['api', 'jobs'],
        handler: (request, reply) => {
            const factory = server.settings.app.jobFactory;

            return factory.list({
                paginate: request.query
            }).then(jobs => {
                reply(jobs.map(job => job.toJson()));
            }).catch(err => reply(boom.wrap(err)));
        },
        response: {
            schema: listSchema
        },
        validate: {
            query: schema.api.pagination
        }
    }
});
