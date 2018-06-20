'use strict';

const jwt = require('jsonwebtoken');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const uuid = require('uuid/v4');

const idSchema = joi.reach(schema.models.build.base, 'id');
const artifactSchema = joi.string().label('Artifact Name');

module.exports = config => ({
    method: 'GET',
    path: '/builds/{id}/artifacts/{name*}',
    config: {
        description: 'Get a single build artifact',
        notes: 'Redirects to store with proper token',
        tags: ['api', 'builds', 'artifacts'],
        auth: {
            strategies: ['session', 'token'],
            scope: ['user', 'build', 'pipeline']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const artifact = request.params.name;
            const buildId = request.params.id;

            const encodedArtifact = encodeURIComponent(artifact);

            const token = jwt.sign({
                buildId, artifact, scope: ['user']
            }, config.authConfig.jwtPrivateKey, {
                algorithm: 'RS256',
                expiresIn: '5s',
                jwtid: uuid()
            });

            const baseUrl = `${config.ecosystem.store}/v1/builds/`
                + `${buildId}/ARTIFACTS/${encodedArtifact}?token=${token}`;

            return reply().redirect().location(baseUrl);
        },
        validate: {
            params: {
                id: idSchema,
                name: artifactSchema
            }
        }
    }
});
