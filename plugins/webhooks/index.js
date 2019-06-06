'use strict';

const boom = require('boom');
const joi = require('joi');
const winston = require('winston');
const workflowParser = require('screwdriver-workflow-parser');
const schema = require('screwdriver-data-schema');

const ANNOT_NS = 'screwdriver.cd';
const ANNOT_CHAIN_PR = `${ANNOT_NS}/chainPR`;
const ANNOT_RESTRICT_PR = `${ANNOT_NS}/restrictPR`;
const EXTRA_TRIGGERS = schema.config.regex.EXTRA_TRIGGER;
const CHECKOUT_URL_SCHEMA = schema.config.regex.CHECKOUT_URL;
const CHECKOUT_URL_SCHEMA_REGEXP = new RegExp(CHECKOUT_URL_SCHEMA);
const WAIT_FOR_CHANGEDFILES = 1.8;
const DEFAULT_MAX_BYTES = 1048576;

/**
 * Determine "startFrom" with type, action and branches
 * @param {String} action          SCM webhook action type
 * @param {String} type            Triggered SCM event type ('pr' or 'repo')
 * @param {String} targetBranch    The branch against which commit is pushed
 * @param {String} pipelineBranch  The pipeline branch
 * @returns {String}               startFrom
 */
function determineStartFrom(action, type, targetBranch, pipelineBranch) {
    let startFrom;

    if (type && type === 'pr') {
        startFrom = '~pr';
    } else {
        switch (action) {
        case 'release':
            return '~release';
        case 'tag':
            return '~tag';
        default:
            startFrom = '~commit';
            break;
        }
    }

    return (targetBranch !== pipelineBranch) ? `${startFrom}:${targetBranch}` : startFrom;
}

/**
 * Update admins array
 * @param  {UserFactory}    userFactory     UserFactory object
 * @param  {String}         username        Username of user
 * @param  {String}         scmContext      Scm which pipeline's repository exists in
 * @param  {Pipeline}       pipeline        Pipeline object
 * @return {Promise}                        Updates the pipeline admins and throws an error if not an admin
 */
async function updateAdmins(userFactory, username, scmContext, pipeline) {
    try {
        const user = await userFactory.get({ username, scmContext });
        const userPermissions = await user.getPermissions(pipeline.scmUri);
        const newAdmins = pipeline.admins;

        // Delete user from admin list if bad permissions
        if (!userPermissions.push) {
            delete newAdmins[username];
            // This is needed to make admins dirty and update db
            pipeline.admins = newAdmins;

            return pipeline.update();
        }
        // Add user as admin if permissions good and does not already exist
        if (!pipeline.admins[username]) {
            newAdmins[username] = true;
            // This is needed to make admins dirty and update db
            pipeline.admins = newAdmins;

            return pipeline.update();
        }
    } catch (err) {
        winston.info(err.message);
    }

    return Promise.resolve();
}

/**
 * Update admins for an array of pipelines
 * @param  {Object}     config.userFactory      UserFactory
 * @param  {Array}      config.pipelines        An array of pipelines
 * @param  {String}     config.username         Username
 * @param  {String}     config.scmContext       ScmContext
 */
async function batchUpdateAdmins({ userFactory, pipelines, username, scmContext }) {
    await Promise.all(pipelines.map(pipeline =>
        updateAdmins(userFactory, username, scmContext, pipeline)));
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
 * Check if changedFiles are under rootDir. If no custom rootDir, return true.
 * @param  {Object}  pipeline
 * @param  {Array}  changedFiles
 * @return {Boolean}
 */
function hasChangesUnderRootDir(pipeline, changedFiles) {
    const splitUri = pipeline.scmUri.split(':');
    const rootDir = splitUri.length > 3 ? splitUri[3] : '';
    const changes = changedFiles || [];

    // Only check if rootDir is set
    if (rootDir) {
        return changes.some(file => file.startsWith(rootDir));
    }

    return true;
}

/**
 * Resolve ChainPR flag
 * @method resolveChainPR
 * @param  {Boolean}  chainPR              Plugin Chain PR flag
 * @param  {Pipeline} pipeline             Pipeline
 * @param  {Object}   pipeline.annotations Pipeline-level annotations
 * @return {Boolean}
 */
function resolveChainPR(chainPR, pipeline) {
    const defaultChainPR = typeof chainPR === 'undefined' ? false : chainPR;
    const annotChainPR = pipeline.annotations[ANNOT_CHAIN_PR];

    return typeof annotChainPR === 'undefined' ? defaultChainPR : annotChainPR;
}

/**
 * Returns an object with resolvedChainPR and skipMessage
 * @param  {Object}       config.pipeline       Pipeline
 * @param  {String}       config.prSource       The origin of this PR
 * @param  {String}       config.restrictPR     Restrict PR setting
 * @param  {Boolean}      config.chainPR        Chain PR flag
 * @return {Object}
 */
function getSkipMessageAndChainPR({ pipeline, prSource, restrictPR, chainPR }) {
    const defaultRestrictPR = restrictPR || 'none';
    const restriction = pipeline.annotations[ANNOT_RESTRICT_PR] || defaultRestrictPR;
    const result = {
        resolvedChainPR: resolveChainPR(chainPR, pipeline)
    };

    // Check for restriction upfront
    if (isRestrictedPR(restriction, prSource)) {
        result.skipMessage = 'Skipping build since pipeline is configured to restrict ' +
        `${restriction} and PR is ${prSource}`;
    }

    return result;
}

/**
 * Get all pipelines which has triggered job
 * @method  triggeredPipelines
 * @param   {PipelineFactory}   pipelineFactory The pipeline factory to get the branch list from
 * @param   {Object}            scmConfig       Has the token and scmUri to get branches
 * @param   {String}            branch          The branch which is committed
 * @param   {String}            type            Triggered GitHub event type ('pr' or 'repo')
 * @param   {String}            action          Triggered GitHub event action
 * @param   {Array}            changedFiles     Changed files in this commit
 * @returns {Promise}                           Promise that resolves into triggered pipelines
 */
async function triggeredPipelines(pipelineFactory, scmConfig, branch, type, action, changedFiles) {
    const { scmUri } = scmConfig;
    const splitUri = scmUri.split(':');
    const scmRepoId = `${splitUri[0]}:${splitUri[1]}`;
    const listConfig = { search: { field: 'scmUri', keyword: `${scmRepoId}:%` } };

    const pipelines = await pipelineFactory.list(listConfig);

    let pipelinesOnCommitBranch = [];
    let pipelinesOnOtherBranch = [];

    pipelines.forEach((p) => {
        if (p.scmUri.startsWith(scmUri)) {
            pipelinesOnCommitBranch.push(p);
        } else {
            pipelinesOnOtherBranch.push(p);
        }
    });

    pipelinesOnCommitBranch = pipelinesOnCommitBranch.filter(p =>
        hasChangesUnderRootDir(p, changedFiles));

    pipelinesOnOtherBranch = pipelinesOnOtherBranch.filter(p =>
        hasTriggeredJob(p, determineStartFrom(action, type, branch, null)));

    return pipelinesOnCommitBranch.concat(pipelinesOnOtherBranch);
}

/**
 * Create events for each pipeline
 * @async  createPREvents
 * @param  {Object}       options
 * @param  {String}       options.username        User who created the PR
 * @param  {String}       options.scmConfig       Has the token and scmUri to get branches
 * @param  {String}       options.sha             Specific SHA1 commit to start the build with
 * @param  {String}       options.prRef           Reference to pull request
 * @param  {String}       options.prNum           Pull request number
 * @param  {String}       options.prTitle         Pull request title
 * @param  {Array}        options.changedFiles    List of changed files
 * @param  {String}       options.branch          The branch against which pr is opened
 * @param  {String}       options.action          Event action
 * @param  {String}       options.prSource      The origin of this PR
 * @param  {String}       options.restrictPR    Restrict PR setting
 * @param  {Boolean}      options.chainPR       Chain PR flag
 * @param  {Hapi.request} request                 Request from user
 * @return {Promise}
 */
async function createPREvents(options, request) {
    const { username, scmConfig, sha, prRef, prNum, pipelines,
        prTitle, changedFiles, branch, action, prSource, restrictPR, chainPR } = options;
    const scm = request.server.app.pipelineFactory.scm;
    const eventFactory = request.server.app.eventFactory;
    const pipelineFactory = request.server.app.pipelineFactory;
    const scmDisplayName = scm.getDisplayName({ scmContext: scmConfig.scmContext });
    const userDisplayName = `${scmDisplayName}:${username}`;
    const events = [];

    scmConfig.prNum = prNum;

    for (let i = 0; i < pipelines.length; i += 1) {
        const p = pipelines[i];
        /* eslint-disable no-await-in-loop */
        const b = await p.branch;
        // obtain pipeline's latest commit sha for branch specific job
        const configPipelineSha = await pipelineFactory.scm.getCommitSha(scmConfig);
        /* eslint-enable no-await-in-loop */

        const { skipMessage, resolvedChainPR } = getSkipMessageAndChainPR({
            pipeline: p,
            prSource,
            restrictPR,
            chainPR
        });

        const eventConfig = {
            pipelineId: p.id,
            type: 'pr',
            webhooks: true,
            username,
            scmContext: scmConfig.scmContext,
            sha,
            configPipelineSha,
            startFrom: `~pr:${branch}`,
            changedFiles,
            causeMessage: `${action} by ${userDisplayName}`,
            chainPR: resolvedChainPR,
            prRef,
            prNum,
            prTitle,
            // eslint-disable-next-line no-await-in-loop
            prInfo: await eventFactory.scm.getPrInfo(scmConfig)
        };

        if (skipMessage) {
            eventConfig.skipMessage = skipMessage;
        }

        if (b === branch) {
            eventConfig.startFrom = '~pr';
        }

        events.push(eventFactory.create(eventConfig));
    }

    return Promise.all(events);
}

/**
 * Stop all the relevant PR jobs for an array of pipelines
 * @async  batchStopJobs
 * @param  {Array}      config.pipelines    An array of pipeline
 * @param  {Integer}    config.prNum        PR number
 * @param  {String}     config.action       Event action
 * @param  {String}     config.name         Prefix of the PR job name: PR-prNum
 */
async function batchStopJobs({ pipelines, prNum, action, name }) {
    const prJobs = await Promise.all(pipelines.map(p => p.getJobs({ type: 'pr' })
        .then(jobs => jobs.filter(j => j.name.includes(name)))));
    const flatPRJobs = prJobs.reduce((prev, curr) => prev.concat(curr));

    await Promise.all(flatPRJobs.map(j => stopJob({ job: j, prNum, action })));
}

/**
 * Create a new job and start the build for an opened pull-request
 * @async  pullRequestOpened
 * @param  {Object}       options
 * @param  {String}       options.hookId        Unique ID for this scm event
 * @param  {String}       options.prSource      The origin of this PR
 * @param  {Pipeline}     options.pipeline      Pipeline model for the pr
 * @param  {String}       options.restrictPR    Restrict PR setting
 * @param  {Boolean}      options.chainPR       Chain PR flag
 * @param  {Hapi.request} request               Request from user
 * @param  {Hapi.reply}   reply                 Reply to user
 */
async function pullRequestOpened(options, request, reply) {
    const { hookId } = options;

    return createPREvents(options, request)
        .then((events) => {
            events.forEach((e) => {
                request.log(['webhook', hookId, e.id],
                    `Event ${e.id} started`);
            });

            return reply().code(201);
        })
        .catch((err) => {
            winston.error(`[${hookId}]: ${err}`);

            return reply(boom.boomify(err));
        });
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
    const { pipelines, hookId, name, prNum, action } = options;
    const updatePRJobs = (job => stopJob({ job, prNum, action })
        .then(() => request.log(['webhook', hookId, job.id], `${job.name} stopped`))
        .then(() => {
            job.archived = true;

            return job.update();
        })
        .then(() => request.log(['webhook', hookId, job.id], `${job.name} disabled and archived`)));

    return Promise.all(pipelines.map(p => p.getJobs({ type: 'pr' })
        .then((jobs) => {
            const prJobs = jobs.filter(j => j.name.includes(name));

            return Promise.all(prJobs.map(j => updatePRJobs(j)));
        })))
        .then(() => reply().code(200))
        .catch((err) => {
            winston.error(`[${hookId}]: ${err}`);

            return reply(boom.boomify(err));
        });
}

/**
 * Stop any running builds and start the build for the synchronized pull-request
 * @async  pullRequestSync
 * @param  {Object}       options
 * @param  {String}       options.hookId        Unique ID for this scm event
 * @param  {String}       options.name          Name of the new job (PR-1)
 * @param  {String}       options.prSource      The origin of this PR
 * @param  {String}       options.restrictPR    Restrict PR setting
 * @param  {Boolean}      options.chainPR       Chain PR flag
 * @param  {Pipeline}     options.pipeline      Pipeline model for the pr
 * @param  {Array}        options.changedFiles  List of files that were changed
 * @param  {String}       options.prNum         Pull request number
 * @param  {String}       options.action        Event action
 * @param  {Hapi.request} request               Request from user
 * @param  {Hapi.reply}   reply                 Reply to user
 */
async function pullRequestSync(options, request, reply) {
    const { pipelines, hookId, name, prNum, action } = options;

    await batchStopJobs({ pipelines, name, prNum, action });

    request.log(['webhook', hookId], `Job(s) for ${name} stopped`);

    return createPREvents(options, request)
        .then((events) => {
            events.forEach((e) => {
                request.log(['webhook', hookId, e.id], `Event ${e.id} started`);
            });

            return reply().code(201);
        })
        .catch((err) => {
            winston.error(`[${hookId}]: ${err}`);

            return reply(boom.boomify(err));
        });
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
 * @param  {Boolean}            pluginOptions.chainPR     Chain PR flag
 * @param  {Hapi.request}       request                   Request from user
 * @param  {Hapi.reply}         reply                     Reply to user
 * @param  {String}             token                     The token used to authenticate to the SCM
 * @param  {Object}             parsed
 */
function pullRequestEvent(pluginOptions, request, reply, parsed, token) {
    const pipelineFactory = request.server.app.pipelineFactory;
    const userFactory = request.server.app.userFactory;
    const { hookId, action, checkoutUrl, branch, sha, prNum, prTitle, prRef,
        prSource, username, scmContext, changedFiles, type } = parsed;
    const fullCheckoutUrl = `${checkoutUrl}#${branch}`;
    const scmConfig = {
        scmUri: '',
        token,
        scmContext
    };
    const { restrictPR, chainPR } = pluginOptions;

    request.log(['webhook', hookId], `PR #${prNum} ${action} for ${fullCheckoutUrl}`);

    return pipelineFactory.scm.parseUrl({
        checkoutUrl: fullCheckoutUrl,
        token,
        scmContext
    }).then((scmUri) => {
        scmConfig.scmUri = scmUri;

        return triggeredPipelines(pipelineFactory, scmConfig, branch, type, action, changedFiles);
    }).then(async (pipelines) => {
        if (!pipelines || pipelines.length === 0) {
            const message = 'Skipping since Pipeline triggered by PRs ' +
                `against ${fullCheckoutUrl} does not exist`;

            request.log(['webhook', hookId], message);

            return reply({ message }).code(204);
        }

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
            changedFiles,
            action: action.charAt(0).toUpperCase() + action.slice(1),
            branch,
            fullCheckoutUrl,
            restrictPR,
            chainPR,
            pipelines
        };

        await batchUpdateAdmins({ userFactory, pipelines, username, scmContext });

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
    }).catch((err) => {
        winston.error(`[${hookId}]: ${err}`);

        return reply(boom.boomify(err));
    });
}

/**
 * Create metadata by the parsed event
 * @param   {Object}   parsed   It has information to create metadata
 * @returns {Object}            Metadata
 */
function createMeta(parsed) {
    const { action, ref, releaseId, releaseName, releaseAuthor } = parsed;

    if (action === 'release') {
        return {
            sd: {
                release: {
                    id: releaseId,
                    name: releaseName,
                    author: releaseAuthor
                },
                tag: {
                    name: ref
                }
            }
        };
    } else if (action === 'tag') {
        return {
            sd: {
                tag: {
                    name: ref
                }
            }
        };
    }

    return {};
}

/**
 * Create events for each pipeline
 * @async   createEvents
 * @param   {EventFactory}       eventFactory       To create event
 * @param   {UserFactory}        userFactory        To get user permission
 * @param   {PipelineFactory}    pipelineFactory    To use scm module
 * @param   {Array}              pipelines          The pipelines to start events
 * @param   {Object}             parsed             It has information to create event
 * @param   {String}            [skipMessage]       Message to skip starting builds
 * @returns {Promise}                               Promise that resolves into events
 */
async function createEvents(eventFactory, userFactory, pipelineFactory,
    pipelines, parsed, skipMessage) {
    const { action, branch, sha, username, scmContext, changedFiles, type } = parsed;
    const events = [];
    const meta = createMeta(parsed);

    for (let i = 0; i < pipelines.length; i += 1) {
        const p = pipelines[i];
        /* eslint-disable no-await-in-loop */
        const pipelineBranch = await p.branch;
        /* eslint-enable no-await-in-loop */
        const startFrom = determineStartFrom(action, type, branch, pipelineBranch);

        // empty event is not created when it is triggered by extra triggers (e.g. ~tag, ~release)
        if (EXTRA_TRIGGERS.test(startFrom) && !hasTriggeredJob(p, startFrom)) {
            winston.info(`Event not created: there are no jobs triggered by ${startFrom}`);
        } else {
            /* eslint-disable no-await-in-loop */
            const token = await p.token;
            const scmConfig = {
                scmUri: p.scmUri,
                token,
                scmContext
            };
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
                causeMessage: `Merged by ${username}`,
                meta
            };

            if (skipMessage) {
                eventConfig.skipMessage = skipMessage;
            }

            /* eslint-disable no-await-in-loop */
            await updateAdmins(userFactory, username, scmContext, p);
            /* eslint-enable no-await-in-loop */

            events.push(eventFactory.create(eventConfig));
        }
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
 * @param  {String}             token                  The token used to authenticate to the SCM
 * @param  {String}             [skipMessage]          Message to skip starting builds
 */
async function pushEvent(pluginOptions, request, reply, parsed, skipMessage, token) {
    const eventFactory = request.server.app.eventFactory;
    const pipelineFactory = request.server.app.pipelineFactory;
    const userFactory = request.server.app.userFactory;
    const { hookId, checkoutUrl, branch, scmContext, type, action, changedFiles } = parsed;
    const fullCheckoutUrl = `${checkoutUrl}#${branch}`;
    const scmConfig = {
        scmUri: '',
        token: '',
        scmContext
    };

    request.log(['webhook', hookId], `Push for ${fullCheckoutUrl}`);

    try {
        scmConfig.token = token;
        scmConfig.scmUri = await pipelineFactory.scm.parseUrl({
            checkoutUrl: fullCheckoutUrl,
            token,
            scmContext
        });

        const pipelines = await triggeredPipelines(
            pipelineFactory, scmConfig, branch, type, action, changedFiles
        );
        let events = [];

        if (!pipelines || pipelines.length === 0) {
            request.log(['webhook', hookId],
                `Skipping since Pipeline ${fullCheckoutUrl} does not exist`);
        } else {
            events = await createEvents(
                eventFactory, userFactory, pipelineFactory, pipelines, parsed, skipMessage
            );
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
        winston.error(`[${hookId}]: ${err}`);

        return reply(boom.boomify(err));
    }
}

/** Execute scm.getCommitRefSha()
 * @method getCommitRefSha
 * @param    {Object}     scm
 * @param    {String}     token            The token used to authenticate to the SCM
 * @param    {String}     ref              The reference which we want
 * @param    {String}     checkoutUrl      Scm checkout URL
 * @param    {String}     scmContext       Scm which pipeline's repository exists in
 * @returns  {Promise}                     Specific SHA1 commit to start the build with
 */
async function getCommitRefSha({ scm, token, ref, checkoutUrl, scmContext }) {
    // For example, git@github.com:screwdriver-cd/data-schema.git => screwdriver-cd, data-schema
    const owner = CHECKOUT_URL_SCHEMA_REGEXP.exec(checkoutUrl)[2];
    const repo = CHECKOUT_URL_SCHEMA_REGEXP.exec(checkoutUrl)[3];

    return scm.getCommitRefSha({
        token,
        owner,
        repo,
        ref,
        scmContext
    });
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
 * @param  {Boolean}    options.chainPR         Chain PR flag
 * @param  {Integer}    options.maxBytes        Upper limit on incoming uploads to builds
 * @param  {Function}   next                    Function to call when done
 */
exports.register = (server, options, next) => {
    const scm = server.root.app.pipelineFactory.scm;
    const pluginOptions = joi.attempt(options, joi.object().keys({
        username: joi.string().required(),
        ignoreCommitsBy: joi.array().items(joi.string()).optional(),
        restrictPR: joi.string().valid('all', 'none', 'branch', 'fork').optional(),
        chainPR: joi.boolean().optional(),
        maxBytes: joi.number().integer().optional()
    }), 'Invalid config for plugin-webhooks');

    server.route({
        method: 'POST',
        path: '/webhooks',
        config: {
            description: 'Handle webhook events',
            notes: 'Acts on pull request, pushes, comments, etc.',
            tags: ['api', 'webhook'],
            payload: {
                maxBytes: parseInt(pluginOptions.maxBytes, 10) || DEFAULT_MAX_BYTES
            },
            handler: async (request, reply) => {
                const userFactory = request.server.app.userFactory;
                const ignoreUser = pluginOptions.ignoreCommitsBy;
                let message = 'Unable to process this kind of event';
                let skipMessage;
                let parsedHookId = '';

                try {
                    const parsed = await scm.parseHook(request.headers, request.payload);

                    if (!parsed) { // for all non-matching events or actions
                        return reply({ message }).code(204);
                    }

                    const { type, hookId, username, scmContext, ref, checkoutUrl, action } = parsed;

                    parsedHookId = hookId;

                    request.log(['webhook', hookId], `Received event type ${type}`);

                    // skipping checks
                    if (/\[(skip ci|ci skip)\]/.test(parsed.lastCommitMessage)) {
                        skipMessage = 'Skipping due to the commit message: [skip ci]';
                    }

                    // if skip ci then don't return
                    if (ignoreUser && ignoreUser.includes(username) && !skipMessage) {
                        message = `Skipping because user ${username} is ignored`;
                        request.log(['webhook', hookId], message);

                        return reply({ message }).code(204);
                    }

                    const token = await obtainScmToken(
                        pluginOptions, userFactory, username, scmContext);

                    if (!parsed.sha) {
                        try {
                            parsed.sha = await getCommitRefSha({
                                scm,
                                token,
                                ref,
                                checkoutUrl,
                                scmContext
                            });
                        } catch (err) {
                            request.log(['webhook', hookId, 'getCommitRefSha'], err);

                            // there is a possibility of scm.getCommitRefSha() is not implemented yet
                            return reply({ message }).code(204);
                        }
                    }

                    if (action !== 'release' && action !== 'tag') {
                        await promiseToWait(WAIT_FOR_CHANGEDFILES);

                        parsed.changedFiles = await scm.getChangedFiles({
                            payload: request.payload,
                            type,
                            token,
                            scmContext
                        });
                        request.log(['webhook', hookId],
                            `Changed files are ${parsed.changedFiles}`);
                    }

                    if (type === 'pr') {
                        // disregard skip ci for pull request events
                        return pullRequestEvent(pluginOptions, request, reply, parsed, token);
                    }

                    return pushEvent(pluginOptions, request, reply, parsed, skipMessage, token);
                } catch (err) {
                    winston.error(`[${parsedHookId}]: ${err}`);

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
