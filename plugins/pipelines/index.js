'use strict';

const boom = require('@hapi/boom');
const createRoute = require('./create');
const updateRoute = require('./update');
const removeRoute = require('./remove');
const syncRoute = require('./sync');
const syncWebhooksRoute = require('./syncWebhooks');
const syncPRsRoute = require('./syncPRs');
const getRoute = require('./get');
const listRoute = require('./list');
const badgeRoute = require('./badge');
const jobBadgeRoute = require('./jobBadge');
const listJobsRoute = require('./listJobs');
const listStagesRoute = require('./listStages');
const listTriggersRoute = require('./listTriggers');
const listSecretsRoute = require('./listSecrets');
const listEventsRoute = require('./listEvents');
const listBuildsRoute = require('./listBuilds');
const startAllRoute = require('./startAll');
const createToken = require('./tokens/create');
const updateToken = require('./tokens/update');
const refreshToken = require('./tokens/refresh');
const listTokens = require('./tokens/list');
const removeToken = require('./tokens/remove');
const removeAllTokens = require('./tokens/removeAll');
const metricsRoute = require('./metrics');
const latestBuild = require('./latestBuild');
const latestCommitEvent = require('./latestCommitEvent');
const getAdmin = require('./admins/get');
const deleteCache = require('./caches/delete');
const openPrRoute = require('./openPr');
const createTemplateRoute = require('./templates/create');
const validateTemplateRoute = require('./templates/validate');
const listTemplatesRoute = require('./templates/list');
const listTemplateVersionsRoute = require('./templates/listVersions');
const listTagsRoute = require('./templates/listTags');
const getTemplateRoute = require('./templates/get');
const getTemplateByIdRoute = require('./templates/getTemplateById');
const createTagRoute = require('./templates/createTag');
const getVersionRoute = require('./templates/getVersion');
const removeTemplateRoute = require('./templates/remove');
const removeTemplateTagRoute = require('./templates/removeTag');
const removeTemplateVersionRoute = require('./templates/removeVersion');
const updateTrustedRoute = require('./templates/updateTrusted');
const updateBuildCluster = require('./updateBuildCluster');

/**
 * Pipeline API Plugin
 * @method register
 * @param  {Hapi}     server            Hapi Server
 */
const pipelinesPlugin = {
    name: 'pipelines',
    async register(server) {
        const statusColor = {
            unknown: 'lightgrey',
            disabled: 'lightgrey',
            created: 'lightgrey',
            success: 'green',
            queued: 'blue',
            blocked: 'blue',
            running: 'blue',
            collapsed: 'lightgrey',
            frozen: 'lightgrey',
            unstable: 'yellow',
            failure: 'red',
            aborted: 'red'
        };

        /**
         * Returns an encoded string of subject based on separator of the badge service
         * @method encodeBadgeSubject
         * @param  {String} badgeService           badge service url
         * @param  {String} subject                subject to put in the badge
         * @return {String} encodedSubject
         */
        server.expose('encodeBadgeSubject', ({ badgeService, subject }) => {
            const separator = badgeService.match(/}}(.){{/)[1];

            if (separator === '/') {
                return encodeURIComponent(subject);
            }

            // Reference: https://shields.io/
            if (separator === '-') {
                return subject.replace(/-/g, '--').replace(/_/g, '__');
            }

            return subject;
        });

        /**
         * Returns true if the scope does not include pipeline or includes pipeline
         * and its pipelineId matches the pipeline, otherwise returns false
         * @method isValidToken
         * @param  {String} id                     ID of pipeline
         * @param  {Object} credentials            Credential object from Hapi
         * @param  {String} credentials.pipelineId ID of pipeline which the token is allowed to access
         * @param  {String} credentials.scope      Scope whose token is allowed
         */
        server.expose(
            'isValidToken',
            (id, credentials) =>
                !credentials.scope.includes('pipeline') || parseInt(id, 10) === parseInt(credentials.pipelineId, 10)
        );

        /**
         * Throws error if a credential does not have access to a pipeline
         * If credential has access, returns pipeline
         * @method canAccessPipeline
         * @param {Object}  credentials              Credential object from Hapi
         * @param {String}  credentials.username     Username of the person logged in (or build ID)
         * @param {String}  credentials.scmContext   Scm of the person logged in (or build ID)
         * @param {Array}   credentials.scope        Scope of the credential (user, build, admin)
         * @param {String}  pipelineId               Target pipeline ID
         * @param {String}  permission               Required permission level
         * @param {String}  app                      Server app object
         * @return {Object} pipeline
         */
        server.expose('canAccessPipeline', (credentials, pipelineId, permission, app) => {
            const { username, scmContext, scope, scmUserId } = credentials;
            const { userFactory, pipelineFactory } = app;

            return pipelineFactory.get(pipelineId).then(pipeline => {
                if (!pipeline) {
                    throw boom.notFound(`Pipeline ${pipelineId} does not exist`);
                }

                if (credentials.scope.includes('admin')) {
                    return pipeline;
                }

                if (!pipeline.scmRepo || !pipeline.scmRepo.private || (pipeline.settings && pipeline.settings.public)) {
                    return pipeline;
                }

                if (scope.includes('user')) {
                    return userFactory.get({ username, scmContext }).then(user => {
                        if (!user) {
                            throw boom.notFound(`User ${username} does not exist`);
                        }

                        return user
                            .getPermissions(pipeline.scmUri)
                            .then(permissions => {
                                if (!permissions[permission]) {
                                    throw boom.forbidden(
                                        `User ${username} does not have ${permission} access for this pipeline`
                                    );
                                }

                                return pipeline;
                            })
                            .catch(() => {
                                const scmDisplayName = pipelineFactory.scm.getDisplayName({ scmContext });
                                const adminDetails = server.plugins.banners.screwdriverAdminDetails(
                                    username,
                                    scmDisplayName,
                                    scmUserId
                                );

                                if (adminDetails.isAdmin) {
                                    return pipeline;
                                }

                                throw boom.forbidden(
                                    `User ${username} does not have ${permission} access for this pipeline`
                                );
                            });
                    });
                }

                if (
                    (scope.includes('pipeline') || pipelineId !== credentials.configPipelineId) &&
                    pipelineId !== credentials.pipelineId
                ) {
                    throw boom.forbidden('Token does not have permission for this pipeline');
                }

                return pipeline;
            });
        });

        /**
         * Throws error if a credential does not have permission to remove pipeline template
         * If credential has access, resolves to true
         * @method canRemove
         * @param {Object}  credentials              Credential object from Hapi
         * @param {String}  credentials.username     Username of the person logged in (or build ID)
         * @param {String}  credentials.scmContext   Scm of the person logged in (or build ID)
         * @param {Array}   credentials.scope        Scope of the credential (user, build, admin)
         * @param {String}  [credentials.pipelineId] If credential is a build, this is the pipeline ID
         * @param {Object}  pipelineTemplate         Target pipeline template object
         * @param {String}  permission               Required permission level
         * @param {String}  app                      Server app object
         * @return {Promise}
         */
        server.expose('canRemove', async (credentials, pipelineTemplate, permission, app) => {
            const { username, scmContext, scope } = credentials;
            const { userFactory, pipelineFactory } = app;

            if (credentials.scope.includes('admin')) {
                return true;
            }

            const pipeline = await pipelineFactory.get(pipelineTemplate.pipelineId);

            if (!pipeline) {
                throw boom.notFound(`Pipeline ${pipelineTemplate.pipelineId} does not exist`);
            }

            if (scope.includes('user')) {
                const user = await userFactory.get({ username, scmContext });

                if (!user) {
                    throw boom.notFound(`User ${username} does not exist`);
                }

                const permissions = await user.getPermissions(pipeline.scmUri);

                if (!permissions[permission]) {
                    throw boom.forbidden(
                        `User ${username} does not have ${permission} access for this pipelineTemplate`
                    );
                }

                return true;
            }

            if (pipelineTemplate.pipelineId !== credentials.pipelineId || credentials.isPR) {
                throw boom.forbidden('Not allowed to remove this pipelineTemplate');
            }

            return true;
        });

        server.route([
            createRoute(),
            removeRoute(),
            updateRoute(),
            syncRoute(),
            syncWebhooksRoute(),
            syncPRsRoute(),
            getRoute(),
            listRoute(),
            badgeRoute({ statusColor }),
            jobBadgeRoute({ statusColor }),
            listJobsRoute(),
            listStagesRoute(),
            listTriggersRoute(),
            listSecretsRoute(),
            listEventsRoute(),
            listBuildsRoute(),
            startAllRoute(),
            updateToken(),
            refreshToken(),
            createToken(),
            listTokens(),
            removeToken(),
            removeAllTokens(),
            metricsRoute(),
            latestBuild(),
            latestCommitEvent(),
            getAdmin(),
            deleteCache(),
            openPrRoute(),
            createTemplateRoute(),
            validateTemplateRoute(),
            listTemplatesRoute(),
            listTemplateVersionsRoute(),
            listTagsRoute(),
            getVersionRoute(),
            getTemplateByIdRoute(),
            getTemplateRoute(),
            createTagRoute(),
            removeTemplateRoute(),
            removeTemplateTagRoute(),
            removeTemplateVersionRoute(),
            updateTrustedRoute(),
            updateBuildCluster()
        ]);
    }
};

module.exports = pipelinesPlugin;
