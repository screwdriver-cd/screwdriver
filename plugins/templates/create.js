'use strict';

const boom = require('boom');
const schema = require('screwdriver-data-schema');
const hoek = require('hoek');
const urlLib = require('url');
const MAJOR_MATCH = 1;
const MINOR_MATCH = 2;
const PATCH_MATCH = 3;

module.exports = () => ({
    method: 'POST',
    path: '/templates',
    config: {
        description: 'Create a new template',
        notes: 'Create a specific template',
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
            const pipelineId = request.auth.credentials.pipelineId;
            const name = request.payload.name;
            const labels = request.payload.labels || [];

            return Promise.all([
                pipelineFactory.get(pipelineId),
                templateFactory.list({ name })
            ]).then(([pipeline, templates]) => {
                const VERSION_REGEX = schema.config.regex.VERSION;
                const match = VERSION_REGEX.exec(request.payload.version);
                const major = match[MAJOR_MATCH];
                const minor = match[MINOR_MATCH];
                const version = minor ? `${major}${minor}.0` : `${major}.0.0`;

                const templateConfig = hoek.applyToDefaults(request.payload, {
                    scmUri: pipeline.scmUri,
                    labels,
                    version
                });

                // If template name doesn't exist yet, just create a new entry
                if (templates.length === 0) {
                    return templateFactory.create(templateConfig);
                }

                // If template name exists, but this build's scmUri is not the same as template's scmUri
                // Then this build does not have permission to publish
                if (pipeline.scmUri !== templates[0].scmUri) {
                    throw boom.unauthorized('Not allowed to publish this template');
                }

                // If template name exists and has good permission, get the latest version for major and minor
                const searchVersion = minor ? `${major}${minor}` : major;

                return templateFactory.getTemplate({
                    name,
                    version: searchVersion,
                    labels
                }).then((latest) => {
                    if (!latest) {
                        templateConfig.version = version;
                    } else {
                        const latestMatch = VERSION_REGEX.exec(latest.version);
                        const latestMinor = latestMatch[MINOR_MATCH];
                        const patch = parseInt(
                            latestMatch[PATCH_MATCH].slice(1), 10) + 1;

                        templateConfig.version = `${major}${latestMinor}.${patch}`;
                    }

                    // If the exact version doesn't exists, create a new entry
                    return templateFactory.create(templateConfig);
                });
            })
            .then((template) => {
                const location = urlLib.format({
                    host: request.headers.host,
                    port: request.headers.port,
                    protocol: request.server.info.protocol,
                    pathname: `${request.path}/${template.id}`
                });

                return reply(template.toJson()).header('Location', location).code(201);
            })
            // something broke, respond with error
            .catch(err => reply(boom.wrap(err)));
        },
        validate: {
            payload: schema.models.template.create
        }
    }
});
