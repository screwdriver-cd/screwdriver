'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const nameSchema = schema.models.template.base.extract('name');

module.exports = () => ({
    method: 'GET',
    path: '/templates/{name}/metrics',
    options: {
        description: 'Get all template versions and metrics for a template name with pagination',
        notes: 'Returns all template records and associated metrics for a given template name',
        tags: ['api', 'templates', 'versions'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build']
        },

        handler: async (request, h) => {
            const factory = request.server.app.templateFactory;
            const config = {
                params: {
                    name: request.params.name
                },
                sort: request.query.sort
            };
            const { startTime, endTime, page, count } = request.query;

            if (page || count) {
                config.paginate = {
                    page,
                    count
                };
            }

            if (startTime) {
                config.startTime = startTime;
            }
            if (endTime) {
                config.endTime = endTime;
            }

            return factory
                .listWithMetrics(config)
                .then(templates => {
                    if (templates.length === 0) {
                        throw boom.notFound('Template does not exist');
                    }

                    return h.response(templates);
                })
                .catch(err => {
                    throw err;
                });
        },
        // maybe
        response: {
            schema: joi.array()
        },
        validate: {
            params: joi.object({
                name: nameSchema
            }),
            query: schema.api.pagination.concat(
                joi.object({
                    search: joi.forbidden(), // we don't support search for Template list versions with metrics,
                    startTime: joi.string().isoDate().example('1970-01-01T15:00:00Z'),
                    endTime: joi.string().isoDate().example('1970-01-03T18:00:00Z'),
                    getCount: joi.forbidden(),
                    sortBy: joi.forbidden()
                })
            )
        }
    }
});
