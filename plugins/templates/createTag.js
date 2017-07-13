'use strict';

const boom = require('boom');
const schema = require('screwdriver-data-schema');
const urlLib = require('url');

/* Currently, only build scope is allowed to tag template due to security reasons.
 * The same pipeline that publishes the template has the permission to tag it.
 */
module.exports = () => ({
    method: 'PUT',
    path: '/templates/tags',
    config: {
        description: 'Add or update a template tag',
        notes: 'Add or update a specific template',
        tags: ['api', 'templates'],
        auth: {
            strategies: ['token', 'session'],
            scope: ['build']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const pipelineFactory = request.server.app.pipelineFactory;
            const templateFactory = request.server.app.templateFactory;
            const templateTagFactory = request.server.app.templateTagFactory;
            const pipelineId = request.auth.credentials.pipelineId;
            const config = request.payload;

            return Promise.all([
                pipelineFactory.get(pipelineId),
                templateFactory.get({
                    name: config.name,
                    version: config.version
                }),
                templateTagFactory.get({
                    name: config.name,
                    tag: config.tag
                })
            ]).then(([pipeline, template, templateTag]) => {
                // If template doesn't exist, throw error
                if (!template) {
                    throw boom.notFound(`Template ${config.name}@${config.version} not found`);
                }

                // If template exists, but this build's pipelineId is not the same as template's pipelineId
                // Then this build does not have permission to tag the template
                if (pipeline.id !== template.pipelineId) {
                    throw boom.unauthorized('Not allowed to tag this template');
                }

                // If template tag exists, then the only thing it can update is the version
                if (templateTag) {
                    templateTag.version = config.version;

                    return templateTag.update().then(tag => reply(tag.toJson()).code(200));
                }

                // If template exists, then create the tag
                return templateTagFactory.create(config).then((tag) => {
                    const location = urlLib.format({
                        host: request.headers.host,
                        port: request.headers.port,
                        protocol: request.server.info.protocol,
                        pathname: `${request.path}/${tag.id}`
                    });

                    return reply(tag.toJson()).header('Location', location).code(201);
                });
            }).catch(err => reply(boom.wrap(err)));
        },
        validate: {
            payload: schema.models.templateTag.create
        }
    }
});
