'use strict';

const boom = require('boom');
const joi = require('joi');
const workflowParser = require('screwdriver-workflow-parser');

/**
 * Check if the PR is being restricted or not
 * @method isRestrictedPR
 * @param  {String}       restriction Is the pipeline restricting PR based on origin
 * @param  {String}       prSource    Origin of the PR
 * @return {Boolean}                  Should the build be restricted
 */
function isRestrictedPR(restriction, prSource) {
    switch (restriction) {
    case 'all':
        return true;
    case 'branch':
    case 'fork':
        return prSource === restriction;
    case 'none':
    default:
        return false;
    }
}

/**
 * Stop a job by stopping all the builds associated with it
 * If the build is running, set state to ABORTED
 * @method stopJob
 * @param  {Job}    job     Job to stop
 * @return {Promise}
 */
function stopJob(job) {
    const stopRunningBuild = (build) => {
        if (build.isDone()) {
            return Promise.resolve();
        }
        build.status = 'ABORTED';

        return build.update();
    };

    return job.getRunningBuilds()
        // Stop running builds
        .then(builds => Promise.all(builds.map(stopRunningBuild)));
}

/**
 * Run pull request's main job
 * @method startPRJob
 * @param  {Object}       options
 * @param  {String}       options.username      User who created the PR
 * @param  {String}       options.scmContext    Scm which pipeline's repository exists in
 * @param  {String}       options.sha           Specific SHA1 commit to start the build with
 * @param  {String}       options.prRef         Reference to pull request
 * @param  {String}       options.prNum         Pull request number
 * @param  {Pipeline}     options.pipeline      Pipeline model for the pr
 * @param  {Array}        options.changedFiles  List of changed files
 * @param  {String}       options.token         User Auth Token
 * @param  {Hapi.request} request               Request from user
 * @return {Promise}
 */
function startPRJob(options, request) {
    const { username, scmContext, sha, prRef, prNum, pipeline, changedFiles, token } = options;
    const scm = request.server.app.pipelineFactory.scm;
    const eventFactory = request.server.app.eventFactory;
    const scmDisplayName = scm.getDisplayName({ scmContext });
    const userDisplayName = `${scmDisplayName}:${username}`;

    const scmConfig = {
        prNum,
        token,
        scmContext,
        scmUri: pipeline.scmUri
    };

    return eventFactory.scm.getPrInfo(scmConfig).then((prInfo) => {
        const eventConfig = {
            pipelineId: pipeline.id,
            type: 'pr',
            webhooks: true,
            username,
            scmContext,
            sha,
            prInfo,
            prRef,
            prNum,
            startFrom: '~pr',
            changedFiles,
            causeMessage: `${options.action} by ${userDisplayName}`
        };

        return eventFactory.create(eventConfig);
    });
}

/**
 * Create a new job and start the build for an opened pull-request
 * @method pullRequestOpened
 * @param  {Object}       options
 * @param  {String}       options.hookId        Unique ID for this scm event
 * @param  {String}       options.name          Name of the new job (PR-1)
 * @param  {String}       options.restriction   If we are restricting PRs based on their origin
 * @param  {String}       options.prSource      The origin of this PR
 * @param  {Array}        options.changedFiles  List of files that were changed
 * @param  {Hapi.request} request               Request from user
 * @param  {Hapi.reply}   reply                 Reply to user
 */
function pullRequestOpened(options, request, reply) {
    const { hookId, restriction, prSource } = options;

    // Check for restriction upfront
    if (isRestrictedPR(restriction, prSource)) {
        request.log(['webhook', hookId],
            'Skipping build since pipeline is configured to restrict ' +
            `${restriction} and PR is ${prSource}`);

        return reply().code(204);
    }

    return startPRJob(options, request)
        .then(() => reply().code(201))
        .catch(err => reply(boom.wrap(err)));
}

/**
 * Stop any running builds and disable the job for closed pull-request
 * @method pullRequestClosed
 * @param  {Object}       options
 * @param  {String}       options.hookId     Unique ID for this scm event
 * @param  {String}       options.pipelineId Identifier for the Pipeline
 * @param  {Pipeline}     options.pipeline   Pipeline model for the pr
 * @param  {String}       options.name       Name of the PR: PR-prNum
 * @param  {Hapi.request} request Request from user
 * @param  {Hapi.reply}   reply   Reply to user
 */
function pullRequestClosed(options, request, reply) {
    const { pipeline, hookId, name } = options;
    const updatePRJobs = (job => stopJob(job)
        .then(() => request.log(['webhook', hookId, job.id], `${job.name} stopped`))
        .then(() => {
            job.archived = true;

            return job.update();
        })
        .then(() => request.log(['webhook', hookId, job.id], `${job.name} disabled and archived`)));

    return pipeline.jobs
        .then((jobs) => {
            const prJobs = jobs.filter(j => j.name.includes(name));

            return Promise.all(prJobs.map(j => updatePRJobs(j)));
        })
        .then(() => reply().code(200))
        .catch(err => reply(boom.wrap(err)));
}

/**
 * Stop any running builds and start the build for the synchronized pull-request
 * @method pullRequestSync
 * @param  {Object}       options
 * @param  {String}       options.hookId        Unique ID for this scm event
 * @param  {String}       options.pipelineId    Identifier for the Pipeline
 * @param  {String}       options.name          Name of the job (PR-1)
 * @param  {String}       options.sha           Specific SHA1 commit to start the build with
 * @param  {String}       options.username      User who created the PR
 * @param  {String}       options.scmContext    Scm which pipeline's repository exists in
 * @param  {String}       options.restriction   If we are restricting PRs based on their origin
 * @param  {String}       options.prSource      The origin of this PR
 * @param  {String}       options.prRef         Reference to pull request
 * @param  {Pipeline}     options.pipeline      Pipeline model for the pr
 * @param  {Array}        options.changedFiles  List of files that were changed
 * @param  {Hapi.request} request               Request from user
 * @param  {Hapi.reply}   reply                 Reply to user
 */
function pullRequestSync(options, request, reply) {
    const { pipeline, hookId, restriction, prSource, name } = options;
    let prJobs;

    // Check for restriction upfront
    if (isRestrictedPR(restriction, prSource)) {
        request.log(['webhook', hookId],
            'Skipping build since pipeline is configured to restrict ' +
            `${restriction} and PR is ${prSource}`);

        return reply().code(204);
    }

    return pipeline.jobs
        .then((jobs) => {
            prJobs = jobs.filter(j => j.name.includes(name));

            return Promise.all(prJobs.map(j => stopJob(j)));
        })
        .then(() => request.log(['webhook', hookId], `Job(s) for ${name} stopped`))
        .then(() => startPRJob(options, request))
        .then(() => {
            request.log(['webhook', hookId], `Job(s) for ${name} synced`);

            return reply().code(201);
        })
        // oops. something went wrong
        .catch(err => reply(boom.wrap(err)));
}

/**
 * Obtains the SCM token for a given user. If a user does not have a valid SCM token registered
 * with Screwdriver, it will use a generic user's token instead.
 * Some SCM services have different thresholds between IP requests and token requests. This is
 * to ensure we have a token to access the SCM service without being restricted by these quotas
 * @method obtainScmToken
 * @param  {Object}            pluginOptions
 * @param  {String}            pluginOptions.username Generic scm username
 * @param  {UserFactory}       userFactory            UserFactory object
 * @param  {String}            username               Name of the user that the SCM token is associated with
 * @return {Promise}                                  Promise that resolves into a SCM token
 */
function obtainScmToken(pluginOptions, userFactory, username, scmContext) {
    const genericUsername = pluginOptions.username;

    return userFactory.get({ username, scmContext })
        .then((user) => {
            if (!user) {
                return userFactory.get({ username: genericUsername, scmContext })
                    .then(buildBotUser => buildBotUser.unsealToken());
            }

            return user.unsealToken();
        });
}

/**
 * Act on a Pull Request change (create, sync, close)
 *  - Opening a PR should sync the pipeline (creating the job) and start the new PR job
 *  - Syncing a PR should stop the existing PR job and start a new one
 *  - Closing a PR should stop the PR job and sync the pipeline (disabling the job)
 * @method pullRequestEvent
 * @param  {Object}             pluginOptions
 * @param  {String}             pluginOptions.username Generic scm username
 * @param  {Hapi.request}       request                Request from user
 * @param  {Hapi.reply}         reply                  Reply to user
 * @param  {Object}             parsed
 */
function pullRequestEvent(pluginOptions, request, reply, parsed) {
    const pipelineFactory = request.server.app.pipelineFactory;
    const userFactory = request.server.app.userFactory;
    const { hookId, action, checkoutUrl, branch, sha, prNum, prRef,
        prSource, username, scmContext, changedFiles } = parsed;
    const fullCheckoutUrl = `${checkoutUrl}#${branch}`;
    let scmToken = null;

    request.log(['webhook', hookId], `PR #${prNum} ${action} for ${fullCheckoutUrl}`);

    // Fetch the pipeline associated with this hook
    return obtainScmToken(pluginOptions, userFactory, username, scmContext)
        .then((token) => {
            scmToken = token;

            return pipelineFactory.scm.parseUrl({
                checkoutUrl: fullCheckoutUrl,
                token,
                scmContext
            });
        })
        .then(scmUri => pipelineFactory.get({ scmUri }))
        .then((pipeline) => {
            if (!pipeline) {
                request.log(['webhook', hookId],
                    `Skipping since Pipeline ${fullCheckoutUrl} does not exist`);

                return reply().code(204);
            }

            return pipeline.sync()
                // handle the PR action
                .then((p) => {
                    // @TODO Check for cluster-level default
                    const restriction = p.annotations['beta.screwdriver.cd/restrict-pr'] || 'none';
                    const options = {
                        pipelineId: p.id,
                        name: `PR-${prNum}`,
                        hookId,
                        sha,
                        username,
                        scmContext,
                        prRef,
                        prNum,
                        prSource,
                        pipeline: p,
                        restriction,
                        changedFiles,
                        token: scmToken,
                        action: action.charAt(0).toUpperCase() + action.slice(1)
                    };

                    switch (action) {
                    case 'opened':
                    case 'reopened':
                        return pullRequestOpened(options, request, reply);

                    case 'synchronized':
                        return pullRequestSync(options, request, reply);

                    case 'closed':
                    default:
                        return pullRequestClosed(options, request, reply);
                    }
                });
        })
        .catch(err => reply(boom.wrap(err)));
}

/**
 * Check the pipeline have triggered job or not
 * @method  hasTriggeredJob
 * @param   {Pipeline}  pipeline    The pipeline to check
 * @param   {String}    startFrom   The trigger name
 * @returns {boolean}               If true the pipeline has triggered job
 */
function hasTriggeredJob(pipeline, startFrom) {
    const nextJobs = workflowParser.getNextJobs(pipeline.workflowGraph, {
        trigger: startFrom
    });

    return nextJobs.length > 0;
}

/**
 * Get all pipelines which has triggered job
 * @method  triggerPipelines
 * @param   {pipelineFactory}   pipelineFactory the pipeline factory to get branch list
 * @param   {Object}            scmConfig       has the token and scmUri to get branches
 * @param   {String}            branch          the branch which is committed
 * @returns {Promise}                           Promise that resolves into triggered pipelines
 */
function triggerPipelines(pipelineFactory, scmConfig, branch) {
    return pipelineFactory.scm.getBranchList(scmConfig)
        .then((branches) => {
            const splitUri = scmConfig.scmUri.split(':');

            // only add non pushed branch, because there is possibility the branch is deleted at filter.
            return branches.filter(b => b.name !== branch).map((b) => {
                splitUri[2] = b.name;

                return splitUri.join(':');
            });
        })
        .then(scmUris => pipelineFactory.list({ params: { scmUri: scmUris } }))
        .then(pipelines => pipelines.filter(p => hasTriggeredJob(p, `~commit:${branch}`)))
        .then((pipelines) => {
            const scmUri = scmConfig.scmUri;

            // add pushed branch
            return pipelineFactory.get({ scmUri }).then((p) => {
                if (p) {
                    pipelines.push(p);
                }

                return pipelines;
            });
        });
}

/**
 * Create events for each pipeline
 * @async createEvents
 * @param {EventFactory}    eventFactory    to create event
 * @param {Array}           pipelines       the pipelines to start events
 * @param {String}          parsed          it have a information to create event
 * @returns {Promise}                       Promise that resolves into events
 */
async function createEvents(eventFactory, pipelines, parsed) {
    const { branch, sha, username, scmContext, changedFiles } = parsed;
    const events = [];

    for (let i = 0; i < pipelines.length; i += 1) {
        const p = pipelines[i];
        // eslint-disable-next-line no-await-in-loop
        const b = await p.branch;
        const startFrom = (b === branch) ? '~commit' : `~commit:${branch}`;
        const eventConfig = {
            pipelineId: p.id,
            type: 'pipeline',
            webhooks: true,
            username,
            scmContext,
            startFrom,
            sha,
            changedFiles,
            commitBranch: branch,
            causeMessage: `Merged by ${username}`
        };

        events.push(eventFactory.create(eventConfig));
    }

    return Promise.all(events);
}

/**
 * Act on a Push event
 *  - Should start a new main job
 * @method pushEvent
 * @param  {Object}             pluginOptions
 * @param  {String}             pluginOptions.username Generic scm username
 * @param  {Hapi.request}       request                Request from user
 * @param  {Hapi.reply}         reply                  Reply to user
 */
function pushEvent(pluginOptions, request, reply, parsed) {
    const eventFactory = request.server.app.eventFactory;
    const pipelineFactory = request.server.app.pipelineFactory;
    const userFactory = request.server.app.userFactory;
    const { hookId, checkoutUrl, branch, username, scmContext } = parsed;
    const fullCheckoutUrl = `${checkoutUrl}#${branch}`;
    const scmConfig = {
        scmUri: '',
        token: '',
        scmContext
    };

    request.log(['webhook', hookId], `Push for ${fullCheckoutUrl}`);

    // Fetch the pipeline associated with this hook
    return obtainScmToken(pluginOptions, userFactory, username, scmContext)
        .then((token) => {
            scmConfig.token = token;

            return pipelineFactory.scm.parseUrl({
                checkoutUrl: fullCheckoutUrl,
                token,
                scmContext
            });
        }).then((scmUri) => {
            scmConfig.scmUri = scmUri;

            return triggerPipelines(pipelineFactory, scmConfig, branch);
        }).then((pipelines) => {
            if (!pipelines || pipelines.length === 0) {
                request.log(['webhook', hookId],
                    `Skipping since Pipeline ${fullCheckoutUrl} does not exist`);

                return [];
            }

            return createEvents(eventFactory, pipelines, parsed);
        })
        .then((events) => {
            if (events.length === 0) {
                return reply().code(204);
            }

            events.forEach((e) => {
                request.log(['webhook', hookId, e.id],
                    `event ${e.id} started`);
            });

            return reply().code(201);
        })
        .catch(err => reply(boom.wrap(err)));
}

/**
 * Webhook API Plugin
 * - Validates that webhook events came from the specified scm provider
 *  - Opening a PR should sync the pipeline (creating the job) and start the new PR job
 *  - Syncing a PR should stop the existing PR job and start a new one
 *  - Closing a PR should stop the PR job and sync the pipeline (disabling the job)
 * @method register
 * @param  {Hapi}       server                  Hapi Server
 * @param  {Object}     options                 Configuration
 * @param  {String}     options.username        Generic scm username
 * @param  {Array}      options.ignoreCommitsBy Ignore commits made by these usernames
 * @param  {Function}   next              Function to call when done
 */
exports.register = (server, options, next) => {
    const scm = server.root.app.pipelineFactory.scm;
    const pluginOptions = joi.attempt(options, joi.object().keys({
        username: joi.string().required(),
        ignoreCommitsBy: joi.array().items(joi.string()).optional()
    }), 'Invalid config for plugin-webhooks');

    server.route({
        method: 'POST',
        path: '/webhooks',
        config: {
            description: 'Handle webhook events',
            notes: 'Acts on pull request, pushes, comments, etc.',
            tags: ['api', 'webhook'],
            handler: (request, reply) => {
                const userFactory = request.server.app.userFactory;
                const ignoreUser = pluginOptions.ignoreCommitsBy;

                return scm.parseHook(request.headers, request.payload).then((parsed) => {
                    if (!parsed) { // for all non-matching events or actions
                        return reply().code(204);
                    }

                    const { type, hookId, username, scmContext } = parsed;

                    request.log(['webhook', hookId], `Received event type ${type}`);

                    if (/\[(skip ci|ci skip)\]/.test(parsed.lastCommitMessage)) {
                        request.log(['webhook', hookId], 'Skipping due to the commit message');

                        return reply().code(204);
                    }

                    if (ignoreUser.includes(username)) {
                        request.log(['webhook', hookId],
                            `Skipping because user ${username} is ignored`);

                        return reply().code(204);
                    }

                    return obtainScmToken(pluginOptions, userFactory, username, scmContext)
                        .then(token => scm.getChangedFiles({
                            payload: request.payload,
                            type,
                            token,
                            scmContext
                        }))
                        .then((changedFiles) => {
                            parsed.changedFiles = changedFiles;

                            request.log(['webhook', hookId],
                                `Changed files are ${parsed.changedFiles}`);

                            if (type === 'pr') {
                                return pullRequestEvent(pluginOptions, request, reply, parsed);
                            }

                            return pushEvent(pluginOptions, request, reply, parsed);
                        });
                })
                    .catch(err => reply(boom.wrap(err)));
            } }
    });

    next();
};

exports.register.attributes = {
    name: 'webhooks'
};
