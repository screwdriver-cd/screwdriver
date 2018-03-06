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
 * Publish binary command
 * @method binaryCommandPublish
 * @param  {CommandFactory} commandFactory      commandFactory
 * @param  {Object}         config              Command config
 * @param  {Binary}         binary              Binary published to the store
 * @param  {String}         storeUrl            URL to the store
 * @param  {String}         authToken           Bearer Token to be passed to the store
 * @return {Promise}
 */
function binaryCommandPublish(commandFactory, config, binary, storeUrl, authToken) {
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
                body: binary
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
                    + `posting binary to the store:${response.body.message}`);
            }

            return commandFactory.create(config);
        });
}

module.exports = () => ({
    method: 'POST',
    path: '/commands',
    config: {
        description: 'Create a new command',
        notes: 'Create a specific command',
        tags: ['api', 'commands'],
        auth: {
            strategies: ['token', 'session'],
            scope: ['build']
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
            let commandSpec;
            let commandBin;

            // if Content-type is multipart/form-data, both command binary and meta are posted
            if (request.headers['content-type'].startsWith('multipart/form-data')) {
                if (data.file === undefined || data.file.length !== 2) {
                    return reply(boom.badRequest('Posted invalid number of files.'));
                }
                data.file.forEach((file) => {
                    if (typeof file === 'string') {
                        commandSpec = file;
                    } else {
                        commandBin = file;
                    }
                });
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

                        // If command format is binary and no binary file is posted, The request is invalid
                        if (commandConfig.format === 'binary' && !commandBin) {
                            throw boom.badRequest(
                                'Binary command should post with the binary file');
                        }

                        // If command name exists, but this build's pipelineId is not the same as command's pipelineId
                        // Then this build does not have permission to publish
                        if (commands.length !== 0 && pipeline.id !== commands[0].pipelineId) {
                            throw boom.unauthorized('Not allowed to publish this command');
                        }

                        // If command name doesn't exist yet, or exists and has good permission, then create
                        // Create would automatically bump the patch version
                        // If command format is binary, binary file also has to be posted to the store
                        return commandConfig.format !== 'binary'
                            ? commandFactory.create(commandConfig)
                            : binaryCommandPublish(commandFactory,
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
