'use strict';

const jwt = require('jsonwebtoken');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const uuid = require('uuid/v4');

const idSchema = joi.reach(schema.models.build.base, 'id');
const artifactSchema = joi.string().label('Artifact Name');
const downloadSchema = joi.string().valid(['', 'false', 'true']).label('Flag to trigger download');

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

            let baseUrl = `${config.ecosystem.store}/v1/builds/`
                + `${buildId}/ARTIFACTS/${encodedArtifact}?token=${token}`;

            if (request.query.download) {
                baseUrl += `&download=${request.query.download}`;
            }

            return reply().redirect().location(baseUrl);
        },
        validate: {
            params: {
                id: idSchema,
                name: artifactSchema
            },
            query: {
                download: downloadSchema
            }
        }
    }
});
