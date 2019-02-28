'use strict';

const boom = require('boom');
const joi = require('joi');
const workflowParser = require('screwdriver-workflow-parser');

const WAIT_FOR_CHANGEDFILES = 1.8;

/**
 * Update admins array
 * @param  {Object}    permissions  User permissions
 * @param  {Pipeline}  pipeline     Pipeline object to update
 * @param  {String}    username     Username of user
 * @return {Promise}                Updates the pipeline admins and throws an error if not an admin
 */
function updateAdmins(permissions, pipeline, username) {
    const newAdmins = pipeline.admins;

    // Delete user from admin list if bad permissions
    if (!permissions.push) {
        delete newAdmins[username];
        // This is needed to make admins dirty and update db
        pipeline.admins = newAdmins;

        return pipeline.update()
            .then(() => {
                throw boom.forbidden(`User ${username} `
                + 'does not have push permission for this repo');
            });
    }

    // Add user as admin if permissions good and does not already exist
    if (!pipeline.admins[username]) {
        newAdmins[username] = true;
        // This is needed to make admins dirty and update db
        pipeline.admins = newAdmins;

        return pipeline.update();
    }

    return Promise.resolve();
}

/**
 * Promise to wait a certain number of seconds
 *
 * Might make this centralized for other tests to leverage
 *
 * @method promiseToWait
 * @param  {Number}      timeToWait  Number of seconds to wait before continuing the chain
 * @return {Promise}
 */
function promiseToWait(timeToWait) {
    return new Promise((resolve) => {
        setTimeout(() => resolve(), timeToWait * 1000);
    });
}

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
 * @param  {Object} config
 * @param  {String} config.action  Event action ('Closed' or 'Synchronized')
 * @param  {Job}    config.job     Job to stop
 * @param  {String} config.prNum   Pull request number
 * @return {Promise}
 */
function stopJob({ job, prNum, action }) {
    const stopRunningBuild = (build) => {
        if (build.isDone()) {
            return Promise.resolve();
        }

        const statusMessage = action === 'Closed' ? `Aborted because PR#${prNum} was closed` :
            `Aborted because new commit was pushed to PR#${prNum}`;

        build.status = 'ABORTED';
        build.statusMessage = statusMessage;

        return build.update();
    };

    return job.getRunningBuilds()
        // Stop running builds
        .then(builds => Promise.all(builds.map(stopRunningBuild)));
}

/**
 * Check if the pipeline has a triggered job or not
 * @method  hasTriggeredJob
 * @param   {Pipeline}  pipeline    The pipeline to check
 * @param   {String}    startFrom   The trigger name
 * @returns {Boolean}               True if the pipeline contains the triggered job
 */
function hasTriggeredJob(pipeline, startFrom) {
    const nextJobs = workflowParser.getNextJobs(pipeline.workflowGraph, {
        trigger: startFrom
    });

    return nextJobs.length > 0;
}

/**
 * Get all pipelines which has triggered job
 * @method  triggeredPipelines
 * @param   {PipelineFactory}   pipelineFactory The pipeline factory to get the branch list from
 * @param   {Object}            scmConfig       Has the token and scmUri to get branches
 * @param   {String}            branch          The branch which is committed
 * @param   {String}            type            Triggered event type ('pr' or 'commit')
 * @returns {Promise}                           Promise that resolves into triggered pipelines
 */
async function triggeredPipelines(pipelineFactory, scmConfig, branch, type) {
    const branches = await pipelineFactory.scm.getBranchList(scmConfig);
    const splitUri = scmConfig.scmUri.split(':');

    // only add non pushed branch, because there is possibility the branch is deleted at filter.
    const scmUris = await branches.filter(b => b.name !== branch).map((b) => {
        splitUri[2] = b.name;

        return splitUri.join(':');
    });

    let pipelines = await pipelineFactory.list({ params: { scmUri: scmUris } });
    const eventType = (type === 'pr') ? 'pr' : 'commit';

    pipelines = pipelines.filter(p => hasTriggeredJob(p, `~${eventType}:${branch}`));

    // add pushed branch
    const p = await pipelineFactory.get({ scmUri: scmConfig.scmUri });

    if (p) {
        pipelines.push(p);
    }

    return pipelines;
}

/**
 * Create events for each pipeline
 * @async  createPREvents
 * @param  {Object}       options
 * @param  {String}       options.username      User who created the PR
 * @param  {String}       options.scmConfig     Has the token and scmUri to get branches
 * @param  {String}       options.sha           Specific SHA1 commit to start the build with
 * @param  {String}       options.prRef         Reference to pull request
 * @param  {String}       options.prNum         Pull request number
 * @param  {String}       options.prTitle       Pull request title
 * @param  {Array}        options.changedFiles  List of changed files
 * @param  {String}       options.branch        The branch against which pr is opened
 * @param  {String}       options.action        Event action
 * @param  {Hapi.request} request               Request from user
 * @return {Promise}
 */
async function createPREvents(options, request) {
    const { username, scmConfig, sha, prRef, prNum,
        prTitle, changedFiles, branch, action } = options;
    const scm = request.server.app.pipelineFactory.scm;
    const eventFactory = request.server.app.eventFactory;
    const pipelineFactory = request.server.app.pipelineFactory;
    const scmDisplayName = scm.getDisplayName({ scmContext: scmConfig.scmContext });
    const userDisplayName = `${scmDisplayName}:${username}`;
    const events = [];
    const pipelines = await triggeredPipelines(pipelineFactory, scmConfig, branch, 'pr');

    scmConfig.prNum = prNum;

    for (let i = 0; i < pipelines.length; i += 1) {
        const p = pipelines[i];
        /* eslint-disable no-await-in-loop */
        const b = await p.branch;
        // obtain pipeline's latest commit sha for branch specific job
        const configPipelineSha = await pipelineFactory.scm.getCommitSha(scmConfig);
        /* eslint-enable no-await-in-loop */

        let eventConfig = {
            pipelineId: p.id,
            type: 'pipeline',
            webhooks: true,
            username,
            scmContext: scmConfig.scmContext,
            sha,
            configPipelineSha,
            startFrom: `~pr:${branch}`,
            changedFiles,
            causeMessage: `${action} by ${userDisplayName}`
        };

        if (b === branch) {
            eventConfig.type = 'pr';
            eventConfig.startFrom = '~pr';
            eventConfig = Object.assign({
                prRef,
                prNum,
                prTitle,
                // eslint-disable-next-line no-await-in-loop
                prInfo: await eventFactory.scm.getPrInfo(scmConfig)
            }, eventConfig);
        }

        events.push(eventFactory.create(eventConfig));
    }

    return Promise.all(events);
}

/**
 * Create a new job and start the build for an opened pull-request
 * @async  pullRequestOpened
 * @param  {Object}       options
 * @param  {String}       options.hookId        Unique ID for this scm event
 * @param  {String}       options.prSource      The origin of this PR
 * @param  {Pipeline}     options.pipeline      Pipeline model for the pr
 * @param  {String}       options.restrictPR    Restrict PR setting
 * @param  {Hapi.request} request               Request from user
 * @param  {Hapi.reply}   reply                 Reply to user
 */
async function pullRequestOpened(options, request, reply) {
    const { hookId, prSource, pipeline, restrictPR } = options;

    if (pipeline) {
        const p = await pipeline.sync();
        const defaultRestrictPR = restrictPR || 'none';
        const restriction = p.annotations['screwdriver.cd/restrictPR'] || defaultRestrictPR;

        // Check for restriction upfront
        if (isRestrictedPR(restriction, prSource)) {
            const message = 'Skipping build since pipeline is configured to restrict ' +
                `${restriction} and PR is ${prSource}`;

            request.log(['webhook', hookId], message);

            return reply({ message }).code(204);
        }
    }

    return createPREvents(options, request)
        .then((events) => {
            events.forEach((e) => {
                request.log(['webhook', hookId, e.id],
                    `Event ${e.id} started`);
            });

            return reply().code(201);
        })
        .catch(err => reply(boom.boomify(err)));
}

/**
 * Stop any running builds and disable the job for closed pull-request
 * @async  pullRequestClosed
 * @param  {Object}       options
 * @param  {String}       options.hookId            Unique ID for this scm event
 * @param  {Pipeline}     options.pipeline          Pipeline model for the pr
 * @param  {String}       options.name              Name of the PR: PR-prNum
 * @param  {String}       options.prNum             Pull request number
 * @param  {String}       options.action            Event action
 * @param  {String}       options.fullCheckoutUrl   CheckoutUrl with branch name
 * @param  {Hapi.request} request                   Request from user
 * @param  {Hapi.reply}   reply                     Reply to user
 */
async function pullRequestClosed(options, request, reply) {
    const { pipeline, hookId, name, prNum, action, fullCheckoutUrl } = options;
    const updatePRJobs = (job => stopJob({ job, prNum, action })
        .then(() => request.log(['webhook', hookId, job.id], `${job.name} stopped`))
        .then(() => {
            job.archived = true;

            return job.update();
        })
        .then(() => request.log(['webhook', hookId, job.id], `${job.name} disabled and archived`)));

    if (!pipeline) {
        const message = `Skipping since PR job for ${fullCheckoutUrl} does not exist`;

        request.log(['webhook', hookId], message);

        return reply({ message }).code(204);
    }

    return pipeline.sync()
        .then(p => p.jobs)
        .then((jobs) => {
            const prJobs = jobs.filter(j => j.name.includes(name));

            return Promise.all(prJobs.map(j => updatePRJobs(j)));
        })
        .then(() => reply().code(200))
        .catch(err => reply(boom.boomify(err)));
}

/**
 * Stop any running builds and start the build for the synchronized pull-request
 * @async  pullRequestSync
 * @param  {Object}       options
 * @param  {String}       options.hookId        Unique ID for this scm event
 * @param  {String}       options.name          Name of the new job (PR-1)
 * @param  {String}       options.prSource      The origin of this PR
 * @param  {String}       options.restrictPR    Restrict PR setting
 * @param  {Pipeline}     options.pipeline      Pipeline model for the pr
 * @param  {Array}        options.changedFiles  List of files that were changed
 * @param  {String}       options.prNum         Pull request number
 * @param  {String}       options.action        Event action
 * @param  {Hapi.request} request               Request from user
 * @param  {Hapi.reply}   reply                 Reply to user
 */
async function pullRequestSync(options, request, reply) {
    const { pipeline, hookId, prSource, name, prNum, action, restrictPR } = options;

    if (pipeline) {
        const p = await pipeline.sync();
        const defaultRestrictPR = restrictPR || 'none';
        const restriction = p.annotations['screwdriver.cd/restrictPR'] || defaultRestrictPR;

        // Check for restriction upfront
        if (isRestrictedPR(restriction, prSource)) {
            const message = 'Skipping build since pipeline is configured to restrict ' +
                `${restriction} and PR is ${prSource}`;

            request.log(['webhook', hookId], message);

            return reply({ message }).code(204);
        }

        await p.jobs.then(jobs => jobs.filter(j => j.name.includes(name)))
            .then(prJobs => Promise.all(prJobs.map(j => stopJob({ job: j, prNum, action }))));

        request.log(['webhook', hookId], `Job(s) for ${name} stopped`);
    }

    return createPREvents(options, request)
        .then((events) => {
            events.forEach((e) => {
                request.log(['webhook', hookId, e.id], `Event ${e.id} started`);
            });

            return reply().code(201);
        })
        .catch(err => reply(boom.boomify(err)));
}

/**
 * Obtains the SCM token for a given user. If a user does not have a valid SCM token registered
 * with Screwdriver, it will use a generic user's token instead.
 * Some SCM services have different thresholds between IP requests and token requests. This is
 * to ensure we have a token to access the SCM service without being restricted by these quotas
 * @method obtainScmToken
 * @param  {Object}         pluginOptions
 * @param  {String}         pluginOptions.username  Generic scm username
 * @param  {UserFactory}    userFactory             UserFactory object
 * @param  {String}         username                Name of the user that the SCM token is associated with
 * @param  {String}         scmContext              Scm which pipeline's repository exists in
 * @return {Promise}                                Promise that resolves into a SCM token
 */
async function obtainScmToken(pluginOptions, userFactory, username, scmContext) {
    const genericUsername = pluginOptions.username;
    const user = await userFactory.get({ username, scmContext });

    if (!user) {
        const buildBotUser = await userFactory.get({ username: genericUsername, scmContext });

        return buildBotUser.unsealToken();
    }

    return user.unsealToken();
}

/**
 * Act on a Pull Request change (create, sync, close)
 *  - Opening a PR should sync the pipeline (creating the job) and start the new PR job
 *  - Syncing a PR should stop the existing PR job and start a new one
 *  - Closing a PR should stop the PR job and sync the pipeline (disabling the job)
 * @method pullRequestEvent
 * @param  {Object}             pluginOptions
 * @param  {String}             pluginOptions.username    Generic scm username
 * @param  {String}             pluginOptions.restrictPR  Restrict PR setting
 * @param  {Hapi.request}       request                   Request from user
 * @param  {Hapi.reply}         reply                     Reply to user
 * @param  {Object}             parsed
 */
function pullRequestEvent(pluginOptions, request, reply, parsed) {
    const pipelineFactory = request.server.app.pipelineFactory;
    const userFactory = request.server.app.userFactory;
    const { hookId, action, checkoutUrl, branch, sha, prNum, prTitle, prRef,
        prSource, username, scmContext, changedFiles, type } = parsed;
    const fullCheckoutUrl = `${checkoutUrl}#${branch}`;
    const scmConfig = {
        scmUri: '',
        token: '',
        scmContext
    };
    const { restrictPR } = pluginOptions;

    request.log(['webhook', hookId], `PR #${prNum} ${action} for ${fullCheckoutUrl}`);

    // Fetch the pipeline associated with this hook
    return obtainScmToken(pluginOptions, userFactory, username, scmContext)
        .then((token) => {
            scmConfig.token = token;

            return pipelineFactory.scm.parseUrl({
                checkoutUrl: fullCheckoutUrl,
                token,
                scmContext
            });
        })
        .then((scmUri) => {
            scmConfig.scmUri = scmUri;

            return triggeredPipelines(pipelineFactory, scmConfig, branch, type);
        })
        .then((pipelines) => {
            if (!pipelines || pipelines.length === 0) {
                const message = 'Skipping since Pipeline triggered by PRs ' +
                    `against ${fullCheckoutUrl} does not exist`;

                request.log(['webhook', hookId], message);

                return reply({ message }).code(204);
            }

            return pipelineFactory.get({ scmUri: scmConfig.scmUri })
                .then(async (pipeline) => {
                    const options = {
                        name: `PR-${prNum}`,
                        hookId,
                        sha,
                        username,
                        scmConfig,
                        prRef,
                        prNum,
                        prTitle,
                        prSource,
                        pipeline,
                        changedFiles,
                        action: action.charAt(0).toUpperCase() + action.slice(1),
                        branch,
                        fullCheckoutUrl,
                        restrictPR
                    };

                    /* eslint-disable no-loop-func */
                    await userFactory.get({ username, scmContext })
                        .then(user => user.getPermissions(pipeline.scmUri)
                            .then(userPermissions => updateAdmins(
                                userPermissions,
                                pipeline,
                                username)));
                    /* eslint-enable no-loop-func */

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
        .catch(err => reply(boom.boomify(err)));
}

/**
 * Create events for each pipeline
 * @async   createEvents
 * @param   {EventFactory}       eventFactory       To create event
 * @param   {PipelineFactory}    pipelineFactory    To use scm module
 * @param   {Array}              pipelines          The pipelines to start events
 * @param   {Object}             parsed             It has information to create event
 * @returns {Promise}                               Promise that resolves into events
 */
async function createEvents(eventFactory, userFactory, pipelineFactory, pipelines, parsed) {
    const { branch, sha, username, scmContext, changedFiles } = parsed;
    const events = [];

    for (let i = 0; i < pipelines.length; i += 1) {
        const p = pipelines[i];
        /* eslint-disable no-await-in-loop */
        const b = await p.branch;
        const startFrom = (b === branch) ? '~commit' : `~commit:${branch}`;
        const token = await p.token;
        const scmConfig = {
            scmUri: p.scmUri,
            token,
            scmContext
        };

        /* eslint-disable no-loop-func */
        await userFactory.get({ username, scmContext })
            .then(user => user.getPermissions(p.scmUri)
                .then(userPermissions => updateAdmins(userPermissions, p, username)));
        /* eslint-enable no-loop-func */

        // obtain pipeline's latest commit sha for branch specific job
        const configPipelineSha = await pipelineFactory.scm.getCommitSha(scmConfig);
        /* eslint-enable no-await-in-loop */
        const eventConfig = {
            pipelineId: p.id,
            type: 'pipeline',
            webhooks: true,
            username,
            scmContext,
            startFrom,
            sha,
            configPipelineSha,
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
 * @param  {Object}             parsed                 It has information to create event
 */
async function pushEvent(pluginOptions, request, reply, parsed) {
    const eventFactory = request.server.app.eventFactory;
    const pipelineFactory = request.server.app.pipelineFactory;
    const userFactory = request.server.app.userFactory;
    const { hookId, checkoutUrl, branch, username, scmContext, type } = parsed;
    const fullCheckoutUrl = `${checkoutUrl}#${branch}`;
    const scmConfig = {
        scmUri: '',
        token: '',
        scmContext
    };

    request.log(['webhook', hookId], `Push for ${fullCheckoutUrl}`);

    try {
        // Fetch the pipeline associated with this hook
        const token = await obtainScmToken(pluginOptions, userFactory, username, scmContext);

        scmConfig.token = token;
        scmConfig.scmUri = await pipelineFactory.scm.parseUrl({
            checkoutUrl: fullCheckoutUrl,
            token,
            scmContext
        });

        const pipelines = await triggeredPipelines(pipelineFactory, scmConfig, branch, type);
        let events = [];

        if (!pipelines || pipelines.length === 0) {
            request.log(['webhook', hookId],
                `Skipping since Pipeline ${fullCheckoutUrl} does not exist`);
        } else {
            events = await createEvents(eventFactory, userFactory,
                pipelineFactory, pipelines, parsed);
        }

        const hasBuildEvents = events.filter(e => e.builds !== null);

        if (hasBuildEvents.length === 0) {
            return reply({ message: 'No jobs to start' }).code(204);
        }

        hasBuildEvents.forEach((e) => {
            request.log(['webhook', hookId, e.id], `Event ${e.id} started`);
        });

        return reply().code(201);
    } catch (err) {
        return reply(boom.boomify(err));
    }
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
 * @param  {Array}      options.restrictPR      Restrict PR setting
 * @param  {Function}   next                    Function to call when done
 */
exports.register = (server, options, next) => {
    const scm = server.root.app.pipelineFactory.scm;
    const pluginOptions = joi.attempt(options, joi.object().keys({
        username: joi.string().required(),
        ignoreCommitsBy: joi.array().items(joi.string()).optional(),
        restrictPR: joi.string().valid('all', 'none', 'branch', 'fork').optional()
    }), 'Invalid config for plugin-webhooks');

    server.route({
        method: 'POST',
        path: '/webhooks',
        config: {
            description: 'Handle webhook events',
            notes: 'Acts on pull request, pushes, comments, etc.',
            tags: ['api', 'webhook'],
            handler: async (request, reply) => {
                const userFactory = request.server.app.userFactory;
                const ignoreUser = pluginOptions.ignoreCommitsBy;
                let message = 'Unable to process this kind of event';

                try {
                    const parsed = await scm.parseHook(request.headers, request.payload);

                    if (!parsed) { // for all non-matching events or actions
                        return reply({ message }).code(204);
                    }

                    const { type, hookId, username, scmContext } = parsed;

                    request.log(['webhook', hookId], `Received event type ${type}`);

                    if (/\[(skip ci|ci skip)\]/.test(parsed.lastCommitMessage)) {
                        message = 'Skipping due to the commit message';
                        request.log(['webhook', hookId], message);

                        return reply({ message }).code(204);
                    }

                    if (ignoreUser && ignoreUser.includes(username)) {
                        message = `Skipping because user ${username} is ignored`;
                        request.log(['webhook', hookId], message);

                        return reply({ message }).code(204);
                    }

                    await promiseToWait(WAIT_FOR_CHANGEDFILES);
                    const token = await obtainScmToken(
                        pluginOptions, userFactory, username, scmContext);

                    parsed.changedFiles = await scm.getChangedFiles({
                        payload: request.payload,
                        type,
                        token,
                        scmContext
                    });

                    request.log(['webhook', hookId], `Changed files are ${parsed.changedFiles}`);

                    if (type === 'pr') {
                        return pullRequestEvent(pluginOptions, request, reply, parsed);
                    }

                    return pushEvent(pluginOptions, request, reply, parsed);
                } catch (err) {
                    return reply(boom.boomify(err));
                }
            }
        }
    });

    next();
};

exports.register.attributes = {
    name: 'webhooks'
};
