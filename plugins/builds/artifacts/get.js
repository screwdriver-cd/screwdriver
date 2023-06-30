'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const jwt = require('jsonwebtoken');
const request = require('screwdriver-request');
const schema = require('screwdriver-data-schema');
const { v4: uuidv4 } = require('uuid');
const idSchema = schema.models.build.base.extract('id');
const artifactSchema = joi.string().label('Artifact Name');
const typeSchema = joi.string().default('preview').valid('download', 'preview').label('Flag to trigger type either to download or preview');

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

        handler: async (req, h) => {
            const artifact = req.params.name;
            const buildId = req.params.id;
            const { credentials } = req.auth;
            const { canAccessPipeline } = req.server.plugins.pipelines;
            const { buildFactory, eventFactory } = req.server.app;

            return buildFactory.get(buildId)
                .then(build => {
                    if (!build) {
                        throw boom.notFound('Build does not exist');
                    }

                    return eventFactory.get(build.eventId);
                })
                .then(event => {
                    if (!event) {
                        throw boom.notFound('Event does not exist');
                    }

                    return canAccessPipeline(credentials, event.pipelineId, 'pull', req.server.app);
                })
                .then(async () => {
                    const encodedArtifact = encodeURIComponent(artifact);

                    const token = jwt.sign({
                        buildId, artifact, scope: ['user']
                    }, config.authConfig.jwtPrivateKey, {
                        algorithm: 'RS256',
                        expiresIn: '5s',
                        jwtid: uuidv4()
                    });

                    let baseUrl = `${config.ecosystem.store}/v1/builds/`
                        + `${buildId}/ARTIFACTS/${encodedArtifact}?token=${token}&type=${req.query.type}`;

                    const requestStream = request.stream(baseUrl);

                    let response = h.response(requestStream);

                    return new Promise((resolve, reject) => {
                        requestStream.on('response', response => {
                            resolve(response.headers);
                        });
                        requestStream.on('error', err => {
                            if (err.response && err.response.statusCode === 404) {
                                reject(boom.notFound('File not found'));
                            } else {
                                reject(err);
                            }
                        });
                    }).then(headers => {
                        response.headers['content-type'] = headers['content-type'];
                        response.headers['content-disposition'] = headers['content-disposition'];
                        response.headers['content-length'] = headers['content-length'];
                        
                        // add security
                        response.headers['x-content-type-options'] = 'nosniff';
                        response.headers['strict-transport-security'] ='max-age=31536000';

                        return response;
                    });
                })
                .catch(err => {
                    throw err;
                });
        },
        validate: {
            params: joi.object({
                id: idSchema,
                name: artifactSchema
            }),
            query: joi.object({
                type: typeSchema
            }).options({ allowUnknown: true })
        }
    }
});
