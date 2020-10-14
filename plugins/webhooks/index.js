'use strict';

const joi = require('joi');
const workflowParser = require('screwdriver-workflow-parser');
const schema = require('screwdriver-data-schema');
const logger = require('screwdriver-logger');

const ANNOT_NS = 'screwdriver.cd';
const ANNOT_CHAIN_PR = `${ANNOT_NS}/chainPR`;
const ANNOT_RESTRICT_PR = `${ANNOT_NS}/restrictPR`;
const EXTRA_TRIGGERS = schema.config.regex.EXTRA_TRIGGER;
const CHECKOUT_URL_SCHEMA = schema.config.regex.CHECKOUT_URL;
const CHECKOUT_URL_SCHEMA_REGEXP = new RegExp(CHECKOUT_URL_SCHEMA);
const DEFAULT_MAX_BYTES = 1048576;

/**
 * Check if tag or release filtering is enabled or not
 * @param {String}    action          SCM webhook action type
 * @param {Array}     workflowGraph   pipeline workflowGraph
 * @returns {Boolean} isFilteringEnabled
 */
function isReleaseOrTagFilteringEnabled(action, workflowGraph) {
    let isFilteringEnabled = true;

    workflowGraph.edges.forEach(edge => {
        const releaseOrTagRegExp = action === 'release' ? new RegExp('^~(release)$') : new RegExp('^~(tag)$');

        if (edge.src.match(releaseOrTagRegExp)) {
            isFilteringEnabled = false;
        }
    });

    return isFilteringEnabled;
}
/**
 * Determine "startFrom" with type, action and branches
 * @param {String}   action                    SCM webhook action type
 * @param {String}   type                      Triggered SCM event type ('pr' or 'repo')
 * @param {String}   targetBranch              The branch against which commit is pushed
 * @param {String}   pipelineBranch            The pipeline branch
 * @param {String}   releaseName               SCM webhook release name
 * @param {String}   tagName                   SCM webhook tag name
 * @param {Boolean}  isReleaseOrTagFiltering   If the tag or release filtering is enabled
 * @returns {String} startFrom
 */
function determineStartFrom(action, type, targetBranch, pipelineBranch, releaseName, tagName, isReleaseOrTagFiltering) {
    let startFrom;

    if (type && type === 'pr') {
        startFrom = '~pr';
    } else {
        switch (action) {
            case 'release':
                return releaseName && isReleaseOrTagFiltering ? `~release:${releaseName}` : '~release';
            case 'tag':
                if (!tagName) {
                    logger.error('The ref of SCM Webhook is missing.');

                    return '';
                }

                return isReleaseOrTagFiltering ? `~tag:${tagName}` : '~tag';
            default:
                startFrom = '~commit';
                break;
        }
    }

    return targetBranch !== pipelineBranch ? `${startFrom}:${targetBranch}` : startFrom;
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
        logger.info(err.message);
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
    await Promise.all(pipelines.map(pipeline => updateAdmins(userFactory, username, scmContext, pipeline)));
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
    const stopRunningBuild = build => {
        if (build.isDone()) {
            return Promise.resolve();
        }

        const statusMessage =
            action === 'Closed'
                ? `Aborted because PR#${prNum} was closed`
                : `Aborted because new commit was pushed to PR#${prNum}`;

        build.status = 'ABORTED';
        build.statusMessage = statusMessage;

        return build.update();
    };

    return (
        job
            .getRunningBuilds()
            // Stop running builds
            .then(builds => Promise.all(builds.map(stopRunningBuild)))
    );
}

/**
 * Check if the pipeline has a triggered job or not
 * @method  hasTriggeredJob
 * @param   {Pipeline}  pipeline    The pipeline to check
 * @param   {String}    startFrom   The trigger name
 * @returns {Boolean}               True if the pipeline contains the triggered job
 */
function hasTriggeredJob(pipeline, startFrom) {
    try {
        const nextJobs = workflowParser.getNextJobs(pipeline.workflowGraph, {
            trigger: startFrom
        });

        return nextJobs.length > 0;
    } catch (err) {
        logger.error(`Error finding triggered jobs for ${pipeline.id}: ${err}`);

        return false;
    }
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
        result.skipMessage = `Skipping build since pipeline is configured to restrict ${restriction} and PR is ${prSource}`;
    }

    return result;
}

/**
 * Returns the uri keeping only the host and the repo ID
 * @method  uriTrimmer
 * @param  {String}       uri       The uri to be trimmed
 * @return {String}
 */
const uriTrimmer = uri => {
    const uriToArray = uri.split(':');

    while (uriToArray.length > 2) uriToArray.pop();

    return uriToArray.join(':');
};

/**
 * Get all pipelines which has triggered job
 * @method  triggeredPipelines
 * @param   {PipelineFactory}   pipelineFactory The pipeline factory to get the branch list from
 * @param   {Object}            scmConfig       Has the token and scmUri to get branches
 * @param   {String}            branch          The branch which is committed
 * @param   {String}            type            Triggered GitHub event type ('pr' or 'repo')
 * @param   {String}            action          Triggered GitHub event action
 * @param   {Array}            changedFiles     Changed files in this commit
 * @param   {String}            releaseName     SCM webhook release name
 * @param   {String}            tagName         SCM webhook tag name
 * @returns {Promise}                           Promise that resolves into triggered pipelines
 */
async function triggeredPipelines(
    pipelineFactory,
    scmConfig,
    branch,
    type,
    action,
    changedFiles,
    releaseName,
    tagName
) {
    const { scmUri } = scmConfig;
    const splitUri = scmUri.split(':');
    const scmBranch = `${splitUri[0]}:${splitUri[1]}:${splitUri[2]}`;
    const scmRepoId = `${splitUri[0]}:${splitUri[1]}`;
    const listConfig = { search: { field: 'scmUri', keyword: `${scmRepoId}:%` } };
    const externalRepoSearchConfig = { search: { field: 'subscribedScmUrlsWithActions', keyword: `%${scmRepoId}:%` } };

    const pipelines = await pipelineFactory.list(listConfig);

    const pipelinesWithSubscribedRepos = await pipelineFactory.list(externalRepoSearchConfig);

    let pipelinesOnCommitBranch = [];
    let pipelinesOnOtherBranch = [];

    pipelines.forEach(p => {
        // This uri expects 'scmUriDomain:repoId:branchName:rootDir'. To Compare, rootDir is ignored.
        const splitScmUri = p.scmUri.split(':');
        const pipelineScmBranch = `${splitScmUri[0]}:${splitScmUri[1]}:${splitScmUri[2]}`;

        if (pipelineScmBranch === scmBranch) {
            pipelinesOnCommitBranch.push(p);
        } else {
            pipelinesOnOtherBranch.push(p);
        }
    });

    // Build runs regardless of changedFiles when release/tag trigger
    pipelinesOnCommitBranch = pipelinesOnCommitBranch.filter(
        p => ['release', 'tag'].includes(action) || hasChangesUnderRootDir(p, changedFiles)
    );

    pipelinesOnOtherBranch = pipelinesOnOtherBranch.filter(p => {
        let isReleaseOrTagFiltering = '';

        if (action === 'release' || action === 'tag') {
            isReleaseOrTagFiltering = isReleaseOrTagFilteringEnabled(action, p.workflowGraph);
        }

        return hasTriggeredJob(
            p,
            determineStartFrom(action, type, branch, null, releaseName, tagName, isReleaseOrTagFiltering)
        );
    });

    const currentRepoPipelines = pipelinesOnCommitBranch.concat(pipelinesOnOtherBranch);

    return currentRepoPipelines.concat(pipelinesWithSubscribedRepos);
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
    const {
        username,
        scmConfig,
        prRef,
        prNum,
        pipelines,
        prTitle,
        changedFiles,
        branch,
        action,
        prSource,
        restrictPR,
        chainPR,
        ref,
        releaseName,
        meta
    } = options;
    const { scm } = request.server.app.pipelineFactory;
    const { eventFactory, pipelineFactory, userFactory } = request.server.app;
    const scmDisplayName = scm.getDisplayName({ scmContext: scmConfig.scmContext });
    const userDisplayName = `${scmDisplayName}:${username}`;
    const events = [];
    let { sha } = options;

    scmConfig.prNum = prNum;

    const eventConfigs = await Promise.all(
        pipelines.map(async p => {
            const b = await p.branch;
            // obtain pipeline's latest commit sha for branch specific job
            let configPipelineSha = '';
            let subscribedConfigSha = '';
            let eventConfig = {};

            // Check if the webhook event is from a subscribed repo and
            // and fetch the source repo commit sha and save the subscribed sha
            if (uriTrimmer(scmConfig.scmUri) !== uriTrimmer(p.scmUri)) {
                subscribedConfigSha = sha;

                try {
                    sha = await pipelineFactory.scm.getCommitSha({
                        scmUri: p.scmUri,
                        scmContext: scmConfig.scmContext,
                        token: scmConfig.token
                    });
                } catch (err) {
                    if (err.status >= 500) {
                        throw err;
                    } else {
                        logger.info(`skip create event for branch: ${b}`);
                    }
                }

                configPipelineSha = sha;
            } else {
                try {
                    configPipelineSha = await pipelineFactory.scm.getCommitSha(scmConfig);
                } catch (err) {
                    if (err.status >= 500) {
                        throw err;
                    } else {
                        logger.info(`skip create event for branch: ${b}`);
                    }
                }
            }

            const { skipMessage, resolvedChainPR } = getSkipMessageAndChainPR({
                // Workaround for pipelines which has NULL value in `pipeline.annotations`
                pipeline: !p.annotations ? { annotations: {}, ...p } : p,
                prSource,
                restrictPR,
                chainPR
            });

            const prInfo = await eventFactory.scm.getPrInfo(scmConfig);

            eventConfig = {
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
                prInfo,
                prSource,
                baseBranch: branch
            };

            if (b === branch) {
                eventConfig.startFrom = '~pr';
            }

            // Check if the webhook event is from a subscribed repo and
            // set the jobs entrypoint from ~startfrom
            // For subscribed PR event, it should be mimiced as a commit
            // in order to function properly
            if (uriTrimmer(scmConfig.scmUri) !== uriTrimmer(p.scmUri)) {
                eventConfig = {
                    pipelineId: p.id,
                    type: 'pipeline',
                    webhooks: true,
                    username,
                    scmContext: scmConfig.scmContext,
                    startFrom: '~subscribe',
                    sha,
                    configPipelineSha,
                    changedFiles,
                    baseBranch: branch,
                    causeMessage: `Merged by ${username}`,
                    meta,
                    releaseName,
                    ref,
                    subscribedEvent: true,
                    subscribedConfigSha,
                    subscribedSourceUrl: prInfo.url
                };

                await updateAdmins(userFactory, username, scmConfig.scmContext, p.id);
            }

            if (skipMessage) {
                eventConfig.skipMessage = skipMessage;
            }

            return eventConfig;
        })
    );

    eventConfigs.forEach(eventConfig => {
        if (eventConfig.configPipelineSha) {
            events.push(eventFactory.create(eventConfig));
        }
    });

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
    const prJobs = await Promise.all(
        pipelines.map(p => p.getJobs({ type: 'pr' }).then(jobs => jobs.filter(j => j.name.includes(name))))
    );
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
 * @param  {Hapi.h}       h                     Response toolkit
 */
async function pullRequestOpened(options, request, h) {
    const { hookId } = options;

    return createPREvents(options, request)
        .then(events => {
            events.forEach(e => {
                request.log(['webhook', hookId, e.id], `Event ${e.id} started`);
            });

            return h.response().code(201);
        })
        .catch(err => {
            logger.error(`[${hookId}]: ${err}`);

            throw err;
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
async function pullRequestClosed(options, request, h) {
    const { pipelines, hookId, name, prNum, action } = options;
    const updatePRJobs = job =>
        stopJob({ job, prNum, action })
            .then(() => request.log(['webhook', hookId, job.id], `${job.name} stopped`))
            .then(() => {
                job.archived = true;

                return job.update();
            })
            .then(() => request.log(['webhook', hookId, job.id], `${job.name} disabled and archived`));

    return Promise.all(
        pipelines.map(p =>
            p.getJobs({ type: 'pr' }).then(jobs => {
                const prJobs = jobs.filter(j => j.name.includes(name));

                return Promise.all(prJobs.map(j => updatePRJobs(j)));
            })
        )
    )
        .then(() => h.response().code(200))
        .catch(err => {
            logger.error(`[${hookId}]: ${err}`);

            throw err;
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
async function pullRequestSync(options, request, h) {
    const { pipelines, hookId, name, prNum, action } = options;

    await batchStopJobs({ pipelines, name, prNum, action });

    request.log(['webhook', hookId], `Job(s) for ${name} stopped`);

    return createPREvents(options, request)
        .then(events => {
            events.forEach(e => {
                request.log(['webhook', hookId, e.id], `Event ${e.id} started`);
            });

            return h.response().code(201);
        })
        .catch(err => {
            logger.error(`[${hookId}]: ${err}`);

            throw err;
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
    }
    if (action === 'tag') {
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
function pullRequestEvent(pluginOptions, request, h, parsed, token) {
    const { pipelineFactory } = request.server.app;
    const { userFactory } = request.server.app;
    const {
        hookId,
        action,
        checkoutUrl,
        branch,
        sha,
        prNum,
        prTitle,
        prRef,
        prSource,
        username,
        scmContext,
        changedFiles,
        type,
        releaseName,
        ref
    } = parsed;
    const fullCheckoutUrl = `${checkoutUrl}#${branch}`;
    const scmConfig = {
        scmUri: '',
        token,
        scmContext
    };
    const { restrictPR, chainPR } = pluginOptions;
    const meta = createMeta(parsed);

    request.log(['webhook', hookId], `PR #${prNum} ${action} for ${fullCheckoutUrl}`);

    return pipelineFactory.scm
        .parseUrl({
            checkoutUrl: fullCheckoutUrl,
            token,
            scmContext
        })
        .then(scmUri => {
            scmConfig.scmUri = scmUri;

            return triggeredPipelines(pipelineFactory, scmConfig, branch, type, action, changedFiles, releaseName, ref);
        })
        .then(async pipelines => {
            if (!pipelines || pipelines.length === 0) {
                const message = `Skipping since Pipeline triggered by PRs against ${fullCheckoutUrl} does not exist`;

                request.log(['webhook', hookId], message);

                return h.response({ message }).code(204);
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
                pipelines,
                ref,
                releaseName,
                meta
            };

            await batchUpdateAdmins({ userFactory, pipelines, username, scmContext });

            switch (action) {
                case 'opened':
                case 'reopened':
                    return pullRequestOpened(options, request, h);
                case 'synchronized':
                    return pullRequestSync(options, request, h);
                case 'closed':
                default:
                    return pullRequestClosed(options, request, h);
            }
        })
        .catch(err => {
            logger.error(`[${hookId}]: ${err}`);

            throw err;
        });
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
async function createEvents(
    eventFactory,
    userFactory,
    pipelineFactory,
    pipelines,
    parsed,
    skipMessage,
    scmConfigFromHook
) {
    const { action, branch, sha, username, scmContext, changedFiles, type, releaseName, ref } = parsed;
    const events = [];
    const meta = createMeta(parsed);

    const pipelineTuples = await Promise.all(
        pipelines.map(async p => {
            const resolvedBranch = await p.branch;
            let isReleaseOrTagFiltering = '';

            if (action === 'release' || action === 'tag') {
                isReleaseOrTagFiltering = isReleaseOrTagFilteringEnabled(action, p.workflowGraph);
            }
            const startFrom = determineStartFrom(
                action,
                type,
                branch,
                resolvedBranch,
                releaseName,
                ref,
                isReleaseOrTagFiltering
            );
            const tuple = { branch: resolvedBranch, pipeline: p, startFrom };

            return tuple;
        })
    );

    const ignoreExtraTriggeredPipelines = pipelineTuples.filter(t => {
        // empty event is not created when it is triggered by extra triggers (e.g. ~tag, ~release)
        if (EXTRA_TRIGGERS.test(t.startFrom) && !hasTriggeredJob(t.pipeline, t.startFrom)) {
            logger.warn(`Event not created: there are no jobs triggered by ${t.startFrom}`);

            return false;
        }

        return true;
    });

    const eventConfigs = await Promise.all(
        ignoreExtraTriggeredPipelines.map(async pTuple => {
            try {
                const pipelineBranch = pTuple.branch;
                let isReleaseOrTagFiltering = '';

                if (action === 'release' || action === 'tag') {
                    isReleaseOrTagFiltering = isReleaseOrTagFilteringEnabled(action, pTuple.pipeline.workflowGraph);
                }
                const startFrom = determineStartFrom(
                    action,
                    type,
                    branch,
                    pipelineBranch,
                    releaseName,
                    ref,
                    isReleaseOrTagFiltering
                );
                const token = await pTuple.pipeline.token;
                const scmConfig = {
                    scmUri: pTuple.pipeline.scmUri,
                    token,
                    scmContext
                };
                // obtain pipeline's latest commit sha for branch specific job
                let configPipelineSha = '';

                try {
                    configPipelineSha = await pipelineFactory.scm.getCommitSha(scmConfig);
                } catch (err) {
                    if (err.status >= 500) {
                        throw err;
                    } else {
                        logger.info(`skip create event for branch: ${pipelineBranch}`);
                    }
                }
                const eventConfig = {
                    pipelineId: pTuple.pipeline.id,
                    type: 'pipeline',
                    webhooks: true,
                    username,
                    scmContext,
                    startFrom,
                    sha,
                    configPipelineSha,
                    changedFiles,
                    baseBranch: branch,
                    causeMessage: `Merged by ${username}`,
                    meta,
                    releaseName,
                    ref
                };

                // Check is the webhook event is from a subscribed repo and
                // set the jobs entry point to ~subscribe
                if (uriTrimmer(scmConfigFromHook.scmUri) !== uriTrimmer(pTuple.pipeline.scmUri)) {
                    eventConfig.subscribedEvent = true;
                    eventConfig.startFrom = '~subscribe';
                    eventConfig.subscribedConfigSha = eventConfig.sha;

                    try {
                        eventConfig.sha = await pipelineFactory.scm.getCommitSha(scmConfig);
                    } catch (err) {
                        if (err.status >= 500) {
                            throw err;
                        } else {
                            logger.info(`skip create event for this subscribed trigger`);
                        }
                    }

                    try {
                        const commitInfo = await pipelineFactory.scm.decorateCommit({
                            scmUri: scmConfigFromHook.scmUri,
                            scmContext,
                            sha: eventConfig.subscribedConfigSha,
                            token
                        });

                        eventConfig.subscribedSourceUrl = commitInfo.url;
                    } catch (err) {
                        if (err.status >= 500) {
                            throw err;
                        } else {
                            logger.info(`skip create event for this subscribed trigger`);
                        }
                    }
                }

                if (skipMessage) {
                    eventConfig.skipMessage = skipMessage;
                }

                await updateAdmins(userFactory, username, scmContext, pTuple.pipeline);

                return eventConfig;
            } catch (err) {
                logger.warn(`pipeline:${pTuple.pipeline.id} error in starting event`, err);

                return null;
            }
        })
    );

    eventConfigs.forEach(eventConfig => {
        if (eventConfig && eventConfig.configPipelineSha) {
            events.push(eventFactory.create(eventConfig));
        }
    });

    return Promise.all(events);
}

/**
 * Act on a Push event
 *  - Should start a new main job
 * @method pushEvent
 * @param  {Hapi.request}       request                Request from user
 * @param  {Hapi.h}             h                      Response toolkit
 * @param  {Object}             parsed                 It has information to create event
 * @param  {String}             token                  The token used to authenticate to the SCM
 * @param  {String}             [skipMessage]          Message to skip starting builds
 */
async function pushEvent(request, h, parsed, skipMessage, token) {
    const { eventFactory, pipelineFactory, userFactory } = request.server.app;
    const { hookId, checkoutUrl, branch, scmContext, type, action, changedFiles, releaseName, ref } = parsed;
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
            pipelineFactory,
            scmConfig,
            branch,
            type,
            action,
            changedFiles,
            releaseName,
            ref
        );
        let events = [];

        if (!pipelines || pipelines.length === 0) {
            request.log(['webhook', hookId], `Skipping since Pipeline ${fullCheckoutUrl} does not exist`);
        } else {
            events = await createEvents(
                eventFactory,
                userFactory,
                pipelineFactory,
                pipelines,
                parsed,
                skipMessage,
                scmConfig
            );
        }

        const hasBuildEvents = events.filter(e => e.builds !== null);

        if (hasBuildEvents.length === 0) {
            return h.response({ message: 'No jobs to start' }).code(204);
        }

        hasBuildEvents.forEach(e => {
            request.log(['webhook', hookId, e.id], `Event ${e.id} started`);
        });

        return h.response().code(201);
    } catch (err) {
        logger.error(`[${hookId}]: ${err}`);

        throw err;
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
async function getCommitRefSha({ scm, token, ref, refType, checkoutUrl, scmContext }) {
    // For example, git@github.com:screwdriver-cd/data-schema.git => screwdriver-cd, data-schema
    const owner = CHECKOUT_URL_SCHEMA_REGEXP.exec(checkoutUrl)[2];
    const repo = CHECKOUT_URL_SCHEMA_REGEXP.exec(checkoutUrl)[3];

    return scm.getCommitRefSha({
        token,
        owner,
        repo,
        ref,
        refType,
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
const webhooksPlugin = {
    name: 'webhooks',
    async register(server, options) {
        const pluginOptions = joi.attempt(
            options,
            joi.object().keys({
                username: joi.string().required(),
                ignoreCommitsBy: joi
                    .array()
                    .items(joi.string())
                    .optional(),
                restrictPR: joi
                    .string()
                    .valid('all', 'none', 'branch', 'fork')
                    .optional(),
                chainPR: joi.boolean().optional(),
                maxBytes: joi
                    .number()
                    .integer()
                    .optional()
            }),
            'Invalid config for plugin-webhooks'
        );

        server.route({
            method: 'POST',
            path: '/webhooks',
            options: {
                description: 'Handle webhook events',
                notes: 'Acts on pull request, pushes, comments, etc.',
                tags: ['api', 'webhook'],
                plugins: {
                    'hapi-rate-limit': {
                        enabled: false
                    }
                },
                payload: {
                    maxBytes: parseInt(pluginOptions.maxBytes, 10) || DEFAULT_MAX_BYTES
                },
                handler: async (request, h) => {
                    const { userFactory, pipelineFactory } = request.server.app;
                    const { scm } = pipelineFactory;
                    const ignoreUser = pluginOptions.ignoreCommitsBy;
                    let message = 'Unable to process this kind of event';
                    let skipMessage;
                    let parsedHookId = '';

                    try {
                        const parsed = await scm.parseHook(request.headers, request.payload);

                        if (!parsed) {
                            // for all non-matching events or actions
                            return h.response({ message }).code(204);
                        }

                        const { type, hookId, username, scmContext, ref, checkoutUrl, action, prNum } = parsed;

                        parsedHookId = hookId;

                        request.log(['webhook', hookId], `Received event type ${type}`);

                        // skipping checks
                        if (/\[(skip ci|ci skip)\]/.test(parsed.lastCommitMessage)) {
                            skipMessage = 'Skipping due to the commit message: [skip ci]';
                        }

                        // if skip ci then don't return
                        if (ignoreUser && ignoreUser.length !== 0 && !skipMessage) {
                            const commitAuthors =
                                Array.isArray(parsed.commitAuthors) && parsed.commitAuthors.length !== 0
                                    ? parsed.commitAuthors
                                    : [username];
                            const validCommitAuthors = commitAuthors.filter(author => !ignoreUser.includes(author));

                            if (!validCommitAuthors.length) {
                                message = `Skipping because user ${username} is ignored`;
                                request.log(['webhook', hookId], message);

                                return h.response({ message }).code(204);
                            }
                        }

                        const token = await obtainScmToken(pluginOptions, userFactory, username, scmContext);

                        if (action !== 'release' && action !== 'tag') {
                            let scmUri;

                            if (type === 'pr') {
                                scmUri = await scm.parseUrl({ checkoutUrl, token, scmContext });
                            }
                            parsed.changedFiles = await scm.getChangedFiles({
                                payload: request.payload,
                                type,
                                token,
                                scmContext,
                                scmUri,
                                prNum
                            });
                            request.log(['webhook', hookId], `Changed files are ${parsed.changedFiles}`);
                        } else {
                            // The payload has no sha when webhook event is tag or release, so we need to get it.
                            try {
                                parsed.sha = await getCommitRefSha({
                                    scm,
                                    token,
                                    ref,
                                    refType: 'tags',
                                    checkoutUrl,
                                    scmContext
                                });
                            } catch (err) {
                                request.log(['webhook', hookId, 'getCommitRefSha'], err);

                                // there is a possibility of scm.getCommitRefSha() is not implemented yet
                                return h.response({ message }).code(204);
                            }
                        }

                        if (type === 'pr') {
                            // disregard skip ci for pull request events
                            return pullRequestEvent(pluginOptions, request, h, parsed, token);
                        }

                        return pushEvent(request, h, parsed, skipMessage, token);
                    } catch (err) {
                        logger.error(`[${parsedHookId}]: ${err}`);

                        throw err;
                    }
                }
            }
        });
    }
};

module.exports = webhooksPlugin;
