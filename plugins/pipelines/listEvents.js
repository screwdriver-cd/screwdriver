'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const eventListSchema = joi.array().items(schema.models.event.get).label('List of events');
const prNumSchema = schema.models.event.base.extract('prNum');
const shaSchema = joi
    .string()
    .hex()
    .max(40)
    .description('SHA or partial SHA')
    .example('ccc49349d3cffbd12ea9e3d41521480b4aa5de5f');
const typeSchema = schema.models.event.base.extract('type');
const pipelineIdSchema = schema.models.pipeline.base.extract('id');
const INEQUALITY_SIGNS = /^(gt|lt):([\d]+)$/;
const queryIdSchema = joi
    .alternatives()
    .try(pipelineIdSchema, joi.string().regex(INEQUALITY_SIGNS))
    .description('Event ID; alternatively can use greater than or less than prefix (gt:/lt:)')
    .example('gt:12345');

module.exports = () => ({
    method: 'GET',
    path: '/pipelines/{id}/events',
    options: {
        description: 'Get pipeline type events for this pipeline',
        notes: 'Returns pipeline events for the given pipeline',
        tags: ['api', 'pipelines', 'events'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build', 'pipeline']
        },

        handler: async (request, h) => {
            const factory = request.server.app.pipelineFactory;
            const { page, count, sha, prNum, id, sort, sortBy, groupEventId, message, author, creator } = request.query;

            return factory
                .get(request.params.id)
                .then(pipeline => {
                    if (!pipeline) {
                        throw boom.notFound('Pipeline does not exist');
                    }

                    const eventType = request.query.type || 'pipeline';
                    const config = { params: { type: eventType }, sort };

                    if (page || count) {
                        config.paginate = {
                            page,
                            count
                        };
                    }

                    if (sortBy) {
                        config.sortBy = sortBy;
                    }

                    if (prNum) {
                        config.params.type = 'pr';
                        config.params.prNum = prNum;
                    }

                    // Do a search
                    // See https://www.w3schools.com/sql/sql_like.asp for syntax
                    if (sha) {
                        config.search = { field: ['sha', 'configPipelineSha'], keyword: `${sha}%` };
                    } else if (message) {
                        config.search = { field: ['commit'], keyword: `%"message":"${message}%` };
                    } else if (author) {
                        // searches name and username
                        config.search = { field: ['commit'], keyword: `%name":"${author}%` };
                    } else if (creator) {
                        // searches name and username
                        let inverse = false;
                        let creatorName = creator;

                        if (creator.startsWith('ne:')) {
                            inverse = true;
                            creatorName = creator.substring(3); // Remove 'ne:' prefix
                        }

                        config.search = {
                            field: ['creator'],
                            keyword: `%name":"${creatorName}%`,
                            inverse
                        };
                    }

                    if (groupEventId) {
                        config.params.groupEventId = groupEventId;
                    }

                    // Event id filter; can use greater than(`gt:`) or less than(`lt:`) prefix
                    if (id) {
                        config.params.id = id;
                    }

                    return pipeline.getEvents(config);
                })
                .then(events => h.response(events.map(e => e.toJson())))
                .catch(err => {
                    throw err;
                });
        },
        response: {
            schema: eventListSchema
        },
        validate: {
            params: joi.object({
                id: pipelineIdSchema
            }),
            query: schema.api.pagination.concat(
                joi
                    .object({
                        type: typeSchema,
                        prNum: prNumSchema,
                        sha: shaSchema,
                        message: joi.string().label('Commit message').example('fix: Typo'),
                        author: joi.string().label('Author Name').example('Dao Lam'),
                        creator: joi
                            .string()
                            .label('Creator Name')
                            .description('Creator Name; optionally use "ne:" prefix to exclude creator')
                            .example('Dao Lam')
                            .example('ne:Dao Lam'),
                        id: queryIdSchema,
                        groupEventId: pipelineIdSchema,
                        search: joi.forbidden(), // we don't support search for Pipeline list events
                        getCount: joi.forbidden() // we don't support getCount for Pipeline list events
                    })
                    // https://joi.dev/api/?v=17.13.3#objectoxorpeers-options
                    .oxor('sha', 'message', 'author', 'creator')
                    .messages({
                        'object.oxor': 'You can only specify one search parameter: sha, message, author, or creator.'
                    })
            )
        }
    }
});
