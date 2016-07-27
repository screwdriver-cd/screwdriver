'use strict';
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi.array().items(schema.models.job.get).label('List of Jobs');
const Model = require('screwdriver-models');

module.exports = (datastore) => ({
    method: 'GET',
    path: '/jobs',
    config: {
        description: 'Get jobs with pagination',
        notes: 'Returns all jobs records',
        tags: ['api', 'jobs'],
        handler: (request, reply) => {
            const Job = new Model.Job(datastore);

            Job.list(request.query, reply);
        },
        response: {
            schema: listSchema
        },
        validate: {
            query: schema.api.pagination
        }
    }
});
