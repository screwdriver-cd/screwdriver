'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const helper = require('./helper');
const pipelineIdSchema = schema.models.pipeline.base.extract('id');
const pipelineCheckoutUrlSchema = schema.models.pipeline.create.extract('checkoutUrl');
const pipelineRootDirSchema = schema.models.pipeline.create.extract('rootDir');

module.exports = () => ({
    method: 'POST',
    path: '/pipelines/{id}/openPr',
    options: {
        description: 'Open pull request for repository',
        notes: 'Open pull request',
        tags: ['api', 'pipelines'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest']
        },
        plugins: {
            authorization: {
                permission: 'all'
            }
        },

        handler: async (request, h) => {
            const { pipelineFactory, userFactory } = request.server.app;
            const { username, scmContext } = request.auth.credentials;
            const { files, title, message } = request.payload;
            const checkoutUrl = helper.formatCheckoutUrl(request.payload.checkoutUrl);
            const rootDir = helper.sanitizeRootDir(request.payload.rootDir);
            const pipeline = await pipelineFactory.get(request.params.id);

            if (!pipeline) {
                throw boom.notFound('Pipeline does not exist');
            }

            return userFactory
                .get({ username, scmContext })
                .then(user => {
                    if (!user) {
                        throw boom.notFound(`User ${username} does not exist`);
                    }

                    return user
                        .unsealToken()
                        .then(token => {
                            return userFactory.scm
                                .parseUrl({
                                    scmContext,
                                    rootDir,
                                    checkoutUrl,
                                    token
                                })
                                .then(scmUri => {
                                    if (
                                        scmUri.split(':').slice(0, 2).join(':') !==
                                        pipeline.scmUri.split(':').slice(0, 2).join(':')
                                    ) {
                                        throw boom.forbidden(
                                            'Creating pull requests to repositories other than the pipeline is not permitted'
                                        );
                                    }

                                    return user
                                        .getPermissions(scmUri)
                                        .then(async permissions => {
                                            if (permissions.archived === true) {
                                                throw boom.forbidden(
                                                    'Archived repositories cannot be used for this operation'
                                                );
                                            }

                                            if (!permissions.push) {
                                                throw boom.forbidden(
                                                    `User ${user.getFullDisplayName()} does not have push permission for this repo`
                                                );
                                            }
                                        })
                                        .then(() => {
                                            let scmUrl = checkoutUrl;

                                            // Set branch if missing
                                            if (checkoutUrl.split('#').length === 1) {
                                                scmUrl = scmUrl.concat(`#${scmUri.split(':')[2]}`);
                                            }

                                            return userFactory.scm.openPr({
                                                checkoutUrl: scmUrl,
                                                files,
                                                token,
                                                scmContext,
                                                title,
                                                message
                                            });
                                        })
                                        .catch(error => {
                                            // 404 error throws, if branch name is incorrect
                                            throw boom.boomify(error, { statusCode: error.statusCode });
                                        });
                                });
                        })
                        .then(async pullRequest => {
                            if (!pullRequest) {
                                throw boom.notImplemented('openPr not implemented for gitlab');
                            }
                            const html = await pullRequest.data.html_url;

                            return h.response({ prUrl: html }).code(201);
                        });
                })
                .catch(err => {
                    throw err;
                });
        },
        validate: {
            params: joi.object({
                id: pipelineIdSchema
            }),
            payload: joi.object({
                checkoutUrl: pipelineCheckoutUrlSchema,
                rootDir: pipelineRootDirSchema,
                files: joi
                    .array()
                    .items(
                        joi.object().keys({
                            name: joi.string().required(),
                            content: joi.string().required()
                        })
                    )
                    .min(1)
                    .required(),
                title: joi.string().required(),
                message: joi.string().required()
            })
        }
    }
});
