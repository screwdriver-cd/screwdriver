'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.template.get;
const nameSchema = joi.reach(schema.models.template.base, 'name');
const versionSchema = joi.reach(schema.models.template.base, 'version');
const tagSchema = joi.reach(schema.models.templateTag.base, 'tag');

module.exports = () => ({
    method: 'GET',
    path: '/templates/{name}/{versionOrTag}',
    config: {
        description: 'Get a single template given template name and version or tag',
        notes: 'Returns a template record',
        tags: ['api', 'templates'],
        handler: (request, reply) => {
            const templateFactory = request.server.app.templateFactory;
            const { name, versionOrTag } = request.params;

            return templateFactory.getTemplate(`${name}@${versionOrTag}`)
                .then((template) => {
                    if (!template) {
                        throw boom.notFound(`Template ${name}@${versionOrTag} does not exist`);
                    }

                    return reply(template);
                })
                .catch(err => reply(boom.wrap(err)));
        },
        response: {
            schema: getSchema
        },
        validate: {
            params: {
                name: nameSchema,
                versionOrTag: joi.alternatives().try(
                    versionSchema,
                    tagSchema
                )
            }
        }
    }
});
