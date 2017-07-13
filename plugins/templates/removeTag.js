'use strict';

const boom = require('boom');
const schema = require('screwdriver-data-schema');

/* Currently, only build scope is allowed to tag template due to security reasons.
 * The same pipeline that publishes the template has the permission to tag it.
 */
module.exports = () => ({
    method: 'DELETE',
    path: '/templates/tags',
    config: {
        description: 'Delete a template tag',
        notes: 'Delete a specific template',
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

            return templateTagFactory.get({
                name: config.name,
                tag: config.tag
            })
            .then((templateTag) => {
                if (!templateTag) {
                    throw boom.notFound('Template tag does not exist');
                }

                return Promise.all([
                    pipelineFactory.get(pipelineId),
                    templateFactory.get({
                        name: config.name,
                        version: templateTag.version
                    })
                ])
                .then(([pipeline, template]) => {
                    // Check for permission
                    if (pipeline.id !== template.pipelineId) {
                        throw boom.unauthorized('Not allowed to delete this template tag');
                    }

                    // Remove the template tag, not the template
                    return templateTag.remove();
                });
            })
            .then(() => reply().code(204))
            .catch(err => reply(boom.wrap(err)));
        },
        validate: {
            payload: schema.models.templateTag.remove
        }
    }
});
