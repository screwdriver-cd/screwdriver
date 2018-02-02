'use strict';

const jwt = require('jsonwebtoken');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const uuid = require('uuid/v4');

const getSchema = schema.models.build.get;
const idSchema = joi.reach(schema.models.build.base, 'id');

module.exports = config => ({
    method: 'GET',
    path: '/builds/{id}/artifacts/{name}',
    config: {
        description: 'Get a single build artifact',
        notes: 'Redirects to store with proper token',
        tags: ['api', 'builds', 'artifacts'],
        auth: {
            strategies: ['session'],
            scope: ['user']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ session: [] }]
            }
        },
        handler: (request, reply) => {
            const artifact = request.params.name;
            const buildId = request.params.id;

            const token = jwt.sign({
                buildId, artifact, scope: ['user']
            }, config.auth.jwtPrivateKey, {
                algorithm: 'RS256',
                expiresIn: '5s',
                jwtid: uuid()
            });

            const baseUrl = `${config.ecosystem.store}/v1/builds/`
                + `${buildId}/ARTIFACTS/${artifact}?token=${token}`;

            return reply().redirect().location(baseUrl);
        },
        response: {
            schema: getSchema
        },
        validate: {
            params: {
                id: idSchema
            }
        }
    }
});
