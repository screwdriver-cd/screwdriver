'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const helper = require('./helper');
const pipelineIdSchema = joi.reach(schema.models.pipeline.base, 'id');
const pipelineCheckoutUrlSchema = joi.reach(schema.models.pipeline.create, 'checkoutUrl');
const pipelineRootDirSchema = joi.reach(schema.models.pipeline.create, 'rootDir');

module.exports = () => ({
    method: 'POST',
    path: '/pipelines/{id}/openPr',
    config: {
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
        handler: (request, reply) => {
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

                            return reply(pullRequest.data.url).code(201);
                        });
                })
                .catch(err => reply(boom.boomify(err)));
        },
        validate: {
            params: {
                id: pipelineIdSchema
            },
            payload: {
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
            }
        }
    }
});
