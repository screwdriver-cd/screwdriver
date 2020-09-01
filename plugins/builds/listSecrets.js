'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const buildListSchema = joi
    .array()
    .items(schema.models.secret.get)
    .label('List of secrets');
const buildIdSchema = schema.models.build.base.extract('id');

module.exports = () => ({
    method: 'GET',
    path: '/builds/{id}/secrets',
    options: {
        description: 'Get all secrets for a given build',
        notes: 'Returns all secrets for a given build',
        tags: ['api', 'builds', 'secrets'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build', '!guest']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: async (request, h) => {
            const factory = request.server.app.buildFactory;
            const { credentials } = request.auth;
            const { canAccess } = request.server.plugins.secrets;

            return factory
                .get(request.params.id)
                .then(build => {
                    if (!build) {
                        throw boom.notFound('Build does not exist');
                    }

                    return build.secrets;
                })
                .then(secrets => {
                    if (secrets.length === 0) {
                        return h.response([]);
                    }

                    return canAccess(credentials, secrets[0], 'push', request.server.app).then(showSecret =>
                        h.response(
                            secrets.map(s => {
                                const output = s.toJson();

                                if (!showSecret) {
                                    delete output.value;
                                }

                                return output;
                            })
                        )
                    );
                })
                .catch(err => {
                    throw err;
                });
        },
        response: {
            schema: buildListSchema
        },
        validate: {
            params: joi.object({
                id: buildIdSchema
            })
        }
    }
});
