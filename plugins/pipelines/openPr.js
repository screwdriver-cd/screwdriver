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
            const { scmUri, files} = request.payload;

            // TODO: decide which token to use
            let token;

            return userFactory.get({ username, scmContext })
                .then((user) => {
                    if (!user) {
                        throw boom.notFound(`User ${username} does not exist`);
                    }

                    return user
                        .getPermissions(scmUri)
                        .then(permissions => {
                            if (!permissions.push) {
                                throw boom.forbidden(`User ${username} does not have push permission for this repo`);
                            }
                        })
                        .then(() => userFactory.scm.openPr({
                            scmUri,
                            files,
                            token,
                            scmContext
                        }))
                        .then(() => reply().code(204));
                })
                .catch(err => reply(boom.boomify(err)));
        },
        validate: {
            payload: {
                scmUri: joi.string().required(),
                files: Joi.array().items(
                    Joi.object().keys({
                        fileName: Joi.string().required(),
                        fileContent: Joi.string().required()
                    })
                ).min(1).required()
            }
        }
    }
});
