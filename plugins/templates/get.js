'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.template.get;
const baseSchema = schema.models.template.base;
const versionRegex = schema.config.regex.VERSION;
const versionSchema = joi.reach(baseSchema, 'version');

module.exports = () => ({
    method: 'GET',
    path: '/templates/{name}/{versionOrTag}',
    config: {
        description: 'Get a single template given template name and version or tag',
        notes: 'Returns a template record',
        tags: ['api', 'templates'],
        handler: (request, reply) => {
            const versionOrTag = request.params.versionOrTag;
            const templateFactory = request.server.app.templateFactory;

            // check if version or tag
            const isVersion = versionOrTag.match(versionRegex);

            return new Promise((resolve, reject) => {
                // if tag, get template tag version
                if (!isVersion) {
                    const templateTagFactory = request.server.app.templateTagFactory;

                    return templateTagFactory.get({
                        name: request.params.name,
                        tag: request.params.versionOrTag
                    })
                    .then((templateTag) => {
                        if (!templateTag) {
                            return reject(boom.notFound(`Template ${request.params.name} ` +
                                `does not exist with tag ${request.params.versionOrTag}`));
                        }

                        return resolve(templateTag.version);
                    });
                }

                // otherwise just return the version
                return resolve(versionOrTag);
            })
            .then(version =>
                // get the template
                templateFactory.getTemplate({
                    name: request.params.name,
                    version
                }).then((template) => {
                    if (!template) {
                        throw boom.notFound(`Template ${request.params.name} ` +
                            `does not exist with version ${version}`);
                    }

                    return reply(template);
                })
            )
            .catch(err => reply(boom.wrap(err)));
        },
        response: {
            schema: getSchema
        },
        validate: {
            params: {
                name: joi.reach(baseSchema, 'name'),
                versionOrTag: joi.alternatives().try(
                    versionSchema,
                    joi.reach(schema.models.templateTag.base, 'tag')
                )
            }
        }
    }
});
