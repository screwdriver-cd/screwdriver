'use strict';

const boom = require('boom');
const joi = require('joi');

module.exports = config => ({
    method: 'GET',
    path: '/coverage/{jobId}/links',
    config: {
        description: 'Get links for job coverage',
        notes: 'Returns object with links to job coverage',
        tags: ['api', 'coverage', 'badge'],
        auth: {
            strategies: ['token'],
            scope: ['build']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            config.coveragePlugin.getLinks(request.params.id)
                .then(reply)
                .catch(err => reply(boom.wrap(err)));
        },
        validate: {
            params: {
                jobId: joi.string().max(50)
            }
        }
    }
});
