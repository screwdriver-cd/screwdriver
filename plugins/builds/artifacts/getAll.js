'use strict';

const archiver = require('archiver');
const boom = require('@hapi/boom');
const request = require('got');
const joi = require('joi');
const jwt = require('jsonwebtoken');
const logger = require('screwdriver-logger');
const { PassThrough } = require('stream');
const schema = require('screwdriver-data-schema');
const { v4: uuidv4 } = require('uuid');
const idSchema = schema.models.build.base.extract('id');


module.exports = config => ({
    method: 'GET',
    path: '/builds/{id}/artifacts',
    options: {
        description: 'Get a zipped file including all build artifacts',
        notes: 'Redirects to store with proper token',
        tags: ['api', 'builds', 'artifacts'],
        auth: {
            strategies: ['session', 'token'],
            scope: ['user', 'build', 'pipeline']
        },

        handler: async (req, h) => {
            const { name: artifact, id: buildId } = req.params;
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
                    const token = jwt.sign({
                        buildId, artifact, scope: ['user']
                    }, config.authConfig.jwtPrivateKey, {
                        algorithm: 'RS256',
                        expiresIn: '10m',
                        jwtid: uuidv4()
                    });
                    const baseUrl = `${config.ecosystem.store}/v1/builds/${buildId}/ARTIFACTS`;

                    // Fetch the manifest
                    const manifest = await request({
                        url: `${baseUrl}/manifest.txt?token=${token}`,
                        method: 'GET'
                    }).text();
                    const manifestArray = manifest.trim().split('\n');

                    // Create a stream and set up archiver
                    const archive = archiver('zip', { zlib: { level: 9 } });
                    // PassThrough stream to make archiver readable by Hapi
                    const passThrough = new PassThrough();

                    // Pipe the archive to PassThrough so it can be sent as a response
                    archive.pipe(passThrough);

                    // Fetch the artifact files and append to the archive
                    try {
                        for (const file of manifestArray) {
                            if (file) {
                                const fileStream = request.stream(`${baseUrl}/${file}?token=${token}&type=download`);

                                archive.append(fileStream, { name: file });
                            }
                        }
                        // Finalize the archive after all files are appended
                        archive.finalize();
                    } catch (err) {
                        logger.error('Error while streaming artifact files:', err);
                        archive.emit('error', err);
                    }

                    // Respond with the PassThrough stream (which is now readable by Hapi)
                    return h.response(passThrough)
                        .type('application/zip')
                        .header('Content-Disposition', 'attachment; filename="SD_ARTIFACTS.zip"');
                })
                .catch(err => {
                    throw err;
                });
        },
        validate: {
            params: joi.object({
                id: idSchema
            })
        }
    }
});
