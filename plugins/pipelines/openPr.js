'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const helper = require('./helper');
const pipelineCheckoutUrlSchema =
    joi.reach(schema.models.pipeline.create, 'checkoutUrl').required();
const scmRootDirSchema =
    joi.reach(schema.core.scm, 'rootDir').required();

module.exports = () => ({
    method: 'POST',
    path: '/pipelines/openPr',
    config: {
        description: 'Open a pull request for pipeline',
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
            const { username } = request.auth.credentials;
            const { scmContext } = request.auth.credentials;
            const { files, title, message } = request.payload;
            const checkoutUrl = helper.formatCheckoutUrl(request.payload.checkoutUrl);
            const rootDir = helper.sanitizeRootDir(request.payload.rootDir);

            return userFactory.get({ username, scmContext })
                .then((user) => {
                    if (!user) {
                        throw boom.notFound(`User ${username} does not exist`);
                    }

                    return user.unsealToken()
                        .then(token =>
                            pipelineFactory.scm.parseUrl({
                                scmContext,
                                rootDir,
                                checkoutUrl,
                                token
                            })
                        )
                        .then(scmUri => user.getPermissions(scmUri))
                        .then(permissions => {
                            if (!permissions.push) {
                                throw boom.forbidden(`User ${username} does not have push permission for this repo`);
                            }
                        })
                        .then(token => userFactory.scm.openPr({
                            checkoutUrl,
                            files,
                            token,
                            scmContext,
                            title,
                            message
                        }))
                        .then(pullrequest => reply(pullrequest.url).code(201));
                })
                .catch(err => reply(boom.boomify(err)));
        },
        validate: {
            payload: {
                checkoutUrl: pipelineCheckoutUrlSchema,
                rootDir: scmRootDirSchema,
                files: Joi.array().items(
                    Joi.object().keys({
                        name: Joi.string().required(),
                        content: Joi.string().required()
                    })
                ).min(1).required(),
                title: joi.string().required(),
                message: joi.string().required()
            }
        }
    }
});
