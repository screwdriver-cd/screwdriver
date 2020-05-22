'use strict';

const joi = require('joi');
const api = require('./request');

const SCHEMA_SCOPE_NAME = joi
    .string()
    .valid(['events', 'jobs', 'pipelines'])
    .label('Scope Name');
const SCHEMA_SCOPE_ID = joi
    .number()
    .integer()
    .positive()
    .label('Event/Job/Pipeline ID');

module.exports = () => ({
    method: 'DELETE',
    path: '/caches/{scope}/{id}',
    config: {
        description: 'API to delete cache using scope and id',
        notes: 'Deletes the entire cache folder for pipeline, job or build using its id',
        tags: ['api', 'events', 'jobs', 'pipelines', 'cache'],
        auth: {
            strategies: ['token'],
            scope: ['user']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: async (request, reply) => {
            const res = await api.invoke(request);

            return reply(res).code(res.statusCode);
        },
        validate: {
            params: {
                scope: SCHEMA_SCOPE_NAME,
                id: SCHEMA_SCOPE_ID
            }
        }
    }
});
