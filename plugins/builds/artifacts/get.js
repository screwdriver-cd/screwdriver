'use strict';

const jwt = require('jsonwebtoken');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const uuid = require('uuid');

const idSchema = schema.models.build.base.extract('id');
const artifactSchema = joi.string().label('Artifact Name');
const typeSchema = joi.string().valid('', 'download', 'preview').label('Flag to trigger type either to download or preview');

module.exports = config => ({
    method: 'GET',
    path: '/builds/{id}/artifacts/{name*}',
    options: {
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
        handler: async (request, h) => {
            const artifact = request.params.name;
            const buildId = request.params.id;

            const encodedArtifact = encodeURIComponent(artifact);

            const token = jwt.sign({
                buildId, artifact, scope: ['user']
            }, config.authConfig.jwtPrivateKey, {
                algorithm: 'RS256',
                expiresIn: '5s',
                jwtid: uuid.v4()
            });

            let baseUrl = `${config.ecosystem.store}/v1/builds/`
                + `${buildId}/ARTIFACTS/${encodedArtifact}?token=${token}`;

            if (request.query.type) {
                baseUrl += `&type=${request.query.type}`;
            }

            return h.redirect().location(baseUrl);
        },
        validate: {
            params: joi.object({
                id: idSchema,
                name: artifactSchema
            }),
            query: joi.object({
                type: typeSchema
            })
        }
    }
});
