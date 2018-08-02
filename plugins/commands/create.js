/* eslint no-underscore-dangle: ["error", { "allow": ["_data", "_shot"] }] */

'use strict';

const boom = require('boom');
const schema = require('screwdriver-data-schema');
const validator = require('screwdriver-command-validator');
const hoek = require('hoek');
const urlLib = require('url');
const req = require('request');
const VERSION_REGEX = schema.config.regex.VERSION;
const DEFAULT_BYTES = 1024 * 1024 * 1024; // 1GB

/**
 * Publish file to the store
 * @method publishFileToStore
 * @param  {CommandFactory} commandFactory      commandFactory
 * @param  {Object}         config              Command config
 * @param  {Uint8Array}     file                File published to the store
 * @param  {String}         storeUrl            URL to the store
 * @param  {String}         authToken           Bearer Token to be passed to the store
 * @return {Promise}
 */
function publishFileToStore(commandFactory, config, file, storeUrl, authToken) {
    const [, major, minor] = VERSION_REGEX.exec(config.version);
    const searchVersion = minor ? `${major}${minor}` : major;
    let publishVersion;

    return commandFactory.getCommand(`${config.namespace}/${config.name}@${searchVersion}`)
        .then((latest) => {
            if (!latest) {
                publishVersion = minor ? `${major}${minor}.0` : `${major}.0.0`;
            } else {
                // eslint-disable-next-line max-len
                const [, latestMajor, latestMinor, latestPatch] = VERSION_REGEX.exec(latest.version);
                const patch = parseInt(latestPatch.slice(1), 10) + 1;

                publishVersion = `${latestMajor}${latestMinor}.${patch}`;
            }

            return publishVersion;
        }).then((version) => {
            const options = {
                url: `${storeUrl}/v1/commands/${config.namespace}/${config.name}/${version}`,
                method: 'POST',
                headers: {
                    Authorization: authToken,
                    'Content-Type': 'application/octet-stream'
                },
                body: file
            };

            return new Promise((resolve, reject) => {
                req(options, (err, response) => {
                    if (err) {
                        return reject(err);
                    }

                    return resolve(response);
                });
            });
        }).then((response) => {
            if (response.statusCode !== 202) {
                throw new Error('An error occurred when '
                    + `posting file to the store:${response.body.message}`);
            }

            return commandFactory.create(config);
        });
}

/**
 * Check multipart payload
 * @method checkValidMultipartPayload
 * @param  {Object}         data                payload data
 * @return {Object}
 */
function checkValidMultipartPayload(data) {
    const result = { valid: true, message: '' };

    if (data.spec === undefined) {
        result.valid = false;
        result.message = 'Posted with multipart that has no spec.';

        return result;
    }

    const commandSpec = JSON.parse(data.spec);
    const commandBin = data.file;

    if (commandBin === undefined) {
        result.valid = false;
        result.message = 'Posted with multipart that has no binary.';
        if (commandSpec.format === 'binary') {
            result.message = 'Binary command should post with a binary file';
        } else if (commandSpec.format === 'habitat' && commandSpec.habitat.mode === 'local') {
            result.message = 'Habitat local mode should post with a binary file';
        }

        return result;
    }

    return result;
}

module.exports = () => ({
    method: 'POST',
    path: '/commands',
    config: {
        description: 'Create a new command',
        notes: 'Create a specific command',
        tags: ['api', 'commands'],
        auth: {
            strategies: ['token'],
            scope: ['build', '!guest']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        payload: {
            parse: true,
            maxBytes: DEFAULT_BYTES,
            allow: ['multipart/form-data', 'application/json']
        },
        handler: (request, reply) => {
            const data = request.payload;
            const isPR = request.auth.credentials.isPR;
            let commandSpec;
            let commandBin;
            let multipartCheckResult = { valid: false };

            // if Content-type is multipart/form-data, both command file and meta are posted
            if (request.headers['content-type'].startsWith('multipart/form-data')) {
                multipartCheckResult = checkValidMultipartPayload(data);

                if (multipartCheckResult.valid) {
                    commandSpec = data.spec;
                    commandBin = data.file;
                } else {
                    return reply(boom.badRequest(multipartCheckResult.message));
                }
            } else {
                commandSpec = data.yaml;
            }

            return validator(commandSpec)
                .then((config) => {
                    if (config.errors.length > 0) {
                        throw boom.badRequest(
                            `Command has invalid format: ${config.errors.length} error(s).`,
                            config.errors);
                    }

                    const commandFactory = request.server.app.commandFactory;
                    const pipelineFactory = request.server.app.pipelineFactory;
                    const pipelineId = request.auth.credentials.pipelineId;

                    return Promise.all([
                        pipelineFactory.get(pipelineId),
                        commandFactory.list({
                            params: {
                                namespace: config.command.namespace,
                                name: config.command.name
                            }
                        })
                    ]).then(([pipeline, commands]) => {
                        const commandConfig = hoek.applyToDefaults(config.command, {
                            pipelineId: pipeline.id
                        });

                        // If command name exists, but this build's pipelineId is not the same as command's pipelineId
                        // Then this build does not have permission to publish
                        if (isPR ||
                                (commands.length !== 0 && pipeline.id !== commands[0].pipelineId)) {
                            throw boom.unauthorized('Not allowed to publish this command');
                        }

                        // If command name doesn't exist yet, or exists and has good permission, then create
                        // Create would automatically bump the patch version
                        // If command format is binary or habitat local mode, binary file also has to be posted to the store
                        return !multipartCheckResult.valid
                            ? commandFactory.create(commandConfig)
                            : publishFileToStore(commandFactory,
                                commandConfig,
                                commandBin,
                                request.server.app.ecosystem.store,
                                request.headers.authorization);
                    });
                }).then((command) => {
                    const location = urlLib.format({
                        host: request.headers.host,
                        port: request.headers.port,
                        protocol: request.server.info.protocol,
                        pathname: `${request.path}/${command.id}`
                    });

                    return reply(command.toJson()).header('Location', location).code(201);
                }).catch(err => reply(boom.wrap(err)));
        }
    }
});
