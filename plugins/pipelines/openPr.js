'use strict';

const boom = require('boom');
const joi = require('joi');

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
            const { checkoutUrl, files, title, message} = request.payload;

            return userFactory.get({ username, scmContext })
                .then((user) => {
                    if (!user) {
                        throw boom.notFound(`User ${username} does not exist`);
                    }

                    return user
                        .getPermissions(checkoutUrl)
                        .then(permissions => {
                            if (!permissions.push) {
                                throw boom.forbidden(`User ${username} does not have push permission for this repo`);
                            }
                        })
                        .then(() => user.unsealToken())
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
                checkoutUrl: joi.string().required(),
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
