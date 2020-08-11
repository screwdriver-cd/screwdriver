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
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: async (request, h) => {
            const { userFactory } = request.server.app;
            const { username, scmContext } = request.auth.credentials;
            const { files, title, message } = request.payload;
            const checkoutUrl = helper.formatCheckoutUrl(request.payload.checkoutUrl);
            const rootDir = helper.sanitizeRootDir(request.payload.rootDir);

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
                                .then(scmUri => user.getPermissions(scmUri))
                                .then(permissions => {
                                    if (!permissions.push) {
                                        throw boom.forbidden(
                                            `User ${username} does not have push access for this repo`
                                        );
                                    }
                                })
                                .then(() =>
                                    userFactory.scm.openPr({
                                        checkoutUrl,
                                        files,
                                        token,
                                        scmContext,
                                        title,
                                        message
                                    })
                                );
                        })
                        .then(pullRequest => {
                            if (!pullRequest) {
                                throw boom.notImplemented('openPr not implemented for gitlab');
                            }

                            return h.response({ prUrl: pullRequest.data.html_url }).code(201);
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
