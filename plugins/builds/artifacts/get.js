'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const jwt = require('jsonwebtoken');
const request = require('got');
const schema = require('screwdriver-data-schema');
const archiver = require('archiver');
const { PassThrough } = require('stream');
const logger = require('screwdriver-logger');
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
            const { maxDownloadSize } = buildFactory;

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
                    // Directory should fetch manifest and
                    // gather all files that belong to that directory
                    if (req.query.dir && req.query.type === 'download') {
                        // Create a zip name from the directory structure
                        const zipName = artifact.split('/').slice(-1)[0];

                        try {
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
                            const directoryArray = manifestArray.filter(f => f.startsWith(`./${artifact}/`));
                            let totalSize = 0;

                            // Check file sizes by fetching metadata
                            for (const file of directoryArray) {
                                if (file) {
                                    const fileMetaResponse = await request.head(`${baseUrl}/${file}?token=${token}&type=download`);
                                    const fileSize = parseInt(fileMetaResponse.headers['content-length'], 10);

                                    // Accumulate total size
                                    totalSize += fileSize;

                                    // If total size exceeds allowed limit, stop further processing
                                    if (totalSize > maxDownloadSize) {
                                        throw new Error('Total size of files exceeds the allowed limit of 2GB.');
                                    }
                                }
                            }

                            // Create a stream and set up archiver
                            const archive = archiver('zip', { zlib: { level: 9 } });
                            const passThrough = new PassThrough();

                            // Handle archiver errors
                            archive.on('error', (err) => {
                                logger.error('Archiver error:', err);
                                passThrough.emit('error', err); // Propagate the error to the PassThrough stream
                            });

                            // Handle passThrough errors
                            passThrough.on('error', (err) => {
                                logger.error('PassThrough stream error:', err);
                            });

                            // Pipe the archive to PassThrough
                            archive.pipe(passThrough);

                            // Fetch and append the directory files
                            for (const file of directoryArray) {
                                if (file) {
                                    const fileStream = request.stream(`${baseUrl}/${file}?token=${token}&type=download`);

                                    // Handle errors from file streaming
                                    fileStream.on('error', (err) => {
                                        logger.error(`Error downloading file: ${file}`, err);
                                        archive.emit('error', err); // Emit error to stop the archive process
                                    });

                                    const relativePath = file.replace(`./${artifact}/`, `./${zipName}/`);

                                    // Append the file stream to the archive with the correct relative path
                                    archive.append(fileStream, { name: relativePath });
                                }
                            }

                            // Finalize the archive once all files are appended
                            archive.finalize();

                            // Respond with the PassThrough stream (which is readable by Hapi)
                            return h.response(passThrough)
                                .type('application/zip')
                                .header('Content-Disposition', `attachment; filename="${zipName}_dir.zip"`);
                        } catch (err) {
                            // Catch errors related to the manifest request or other async issues
                            logger.error('Error while streaming artifact files:', err);

                            return h.response({ error: 'Failed to generate ZIP file' }).code(500);
                        }
                    } else {
                        const token = jwt.sign({
                            buildId, artifact, scope: ['user']
                        }, config.authConfig.jwtPrivateKey, {
                            algorithm: 'RS256',
                            expiresIn: '5s',
                            jwtid: uuidv4()
                        });
                        const encodedArtifact = encodeURIComponent(artifact);

                        // Fetch single file
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

                            return response;
                        });
                    }
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
                type: typeSchema,
                dir: joi.boolean().truthy('true').falsy('false').default(false)
            }).options({ allowUnknown: true })
        }
    }
});
