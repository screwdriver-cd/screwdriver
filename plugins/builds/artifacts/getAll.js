'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const jwt = require('jsonwebtoken');
const logger = require('screwdriver-logger');
const request = require('got');
const schema = require('screwdriver-data-schema');
const { v4: uuidv4 } = require('uuid');
const idSchema = schema.models.build.base.extract('id');
const AdmZip = require('adm-zip');

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
                        expiresIn: '5s',
                        jwtid: uuidv4()
                    });
                    // Create zip file and add to it
                    const zip = new AdmZip();
                    const baseUrl = `${config.ecosystem.store}/v1/builds/${buildId}/ARTIFACTS`;

                    try {
                        // Get manifest, figure out list of files to download
                        const manifest = await request({
                            url: `${baseUrl}/manifest.txt?token=${token}`,
                            method: 'GET',
                            context: {
                                token
                            }
                        }).text();
                        const manifestArray = manifest.split('\n');

                        await Promise.all(manifestArray.map(async file => {
                            if (file) { // Could be an empty string
                                const content = await request({
                                    url: `${baseUrl}/${file}?token=${token}&type=download`,
                                    method: 'GET',
                                    context: {
                                        token
                                    }
                                }).buffer();

                                zip.addFile(file, Buffer.from(content, 'utf8'));
                            }
                        }));

                        const content = zip.toBuffer();
                        const contentLength = Buffer.byteLength(content);

                        return h.response(content.toString('hex')).code(200).type('text/plain').bytes(contentLength).header('content-disposition', 'attachment; filename=SD_ARTIFACTS.zip');
                    } catch (err) {
                        logger.error(err);
                        throw new Error(err);
                    }
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
