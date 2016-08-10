'use strict';
const boom = require('boom');
const hoek = require('hoek');
const schema = require('screwdriver-data-schema');
const urlLib = require('url');

const MATCH_COMPONENT_BRANCH_NAME = 4;
/**
 * Format the scm url to include a branch and make case insensitive
 * @method formatScmUrl
 * @param  {String}     scmUrl Github scm url
 * @return {String}            Lowercase scm url with branch name
 */
const formatScmUrl = (scmUrl) => {
    let result = scmUrl;
    const matched = (schema.config.regex.SCM_URL).exec(result);
    let branchName = matched[MATCH_COMPONENT_BRANCH_NAME];

    // Check if branch name exists
    if (!branchName) {
        branchName = '#master';
    }

    // Do not convert branch name to lowercase
    result = result.split('#')[0].toLowerCase().concat(branchName);

    return result;
};

module.exports = (server) => ({
    method: 'POST',
    path: '/pipelines',
    config: {
        description: 'Create a new pipeline',
        notes: 'Create a specific pipeline',
        tags: ['api', 'pipelines'],
        auth: {
            strategies: ['token', 'session'],
            scope: ['user']
        },
        handler: (request, reply) => {
            const pipelineFactory = server.settings.app.pipelineFactory;
            const userFactory = server.settings.app.userFactory;
            const scmUrl = formatScmUrl(request.payload.scmUrl);
            const username = request.auth.credentials.username;

            // fetch the user
            return userFactory.get({ username })
                // get the user permissions for the repo
                .then(user => user.getPermissions(scmUrl))
                // if the user isn't an admin, reject
                .then(permissions => {
                    if (!permissions.admin) {
                        throw boom.unauthorized(`User ${username} is not an admin of this repo`);
                    }
                })
                // see if there is already a pipeline
                .then(() => pipelineFactory.get({ scmUrl }))
                // if there is already a pipeline for the scmUrl, reject
                .then(pipeline => {
                    if (pipeline) {
                        throw boom.conflict('scmUrl needs to be unique');
                    }
                })
                // set up pipeline admins, and create a new pipeline
                .then(() => {
                    const admins = {};

                    admins[username] = true;

                    const pipelineConfig = hoek.applyToDefaults(request.payload, {
                        admins,
                        scmUrl
                    });

                    return pipelineFactory.create(pipelineConfig);
                })
                // hooray, a pipeline is born!
                .then(pipeline =>
                    // sync pipeline to create jobs
                    pipeline.sync()
                        // return pipeline info to requester
                        .then(() => {
                            const location = urlLib.format({
                                host: request.headers.host,
                                port: request.headers.port,
                                protocol: request.server.info.protocol,
                                pathname: `${request.path}/${pipeline.id}`
                            });

                            return reply(pipeline.toJson()).header('Location', location).code(201);
                        })
                )
                // something broke, respond with error
                .catch(err => reply(boom.wrap(err)));
        },
        validate: {
            payload: schema.models.pipeline.create
        }
    }
});
