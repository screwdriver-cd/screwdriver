'use strict';

const boom = require('boom');
const joi = require('joi');
const workflowParser = require('screwdriver-workflow-parser');

/**
 * Check if the PR is being restricted or not
 * @method  isRestrictedPR
 * @param   {String}        restriction Is the pipeline restricting PR based on origin
 * @param   {String}        prSource    Origin of the PR
 * @return  {Boolean}                   Should the build be restricted
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
 * @method  stopJob
 * @param   {Job}   job Job to stop
 * @return  {Promise}
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
 * @param   {String}            type            Triggered event type
 * @returns {Promise}                           Promise that resolves into triggered pipelines
 */
function triggeredPipelines(pipelineFactory, scmConfig, branch, type) {
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
        .then((pipelines) => {
            const eventType = (type === 'pr') ? 'pr' : 'commit';

            return pipelines.filter(p => hasTriggeredJob(p, `~${eventType}:${branch}`));
        })
        .then(pipelines =>
            // add pushed branch
            pipelineFactory.get({ scmUri: scmConfig.scmUri }).then((p) => {
                if (p) {
                    pipelines.push(p);
                }

                return pipelines;
            })
        );
}

/**
 * Create events for each pipeline
 * @async   createPREvents
 * @param   {PipelineFactory}   pipelineFactory     The pipeline factory to get the branch list from
 * @param   {Object}            pipelines           The pipelines which has triggered job
 * @param   {Object}            parsed
 * @param   {String}            parsed.username     User who created the PR
 * @param   {String}            parsed.scmContext   Scm which pipeline's repository exists in
 * @param   {String}            parsed.sha          Specific SHA1 commit to start the build with
 * @param   {String}            parsed.prRef        Reference to pull request
 * @param   {String}            parsed.prNum        Pull request number
 * @param   {Array}             parsed.changedFiles List of changed files
 * @param   {String}            parsed.branch       The branch against which pr is opened
 * @param   {Hapi.request}      request             Request from user
 * @return  {Promise}
 */
async function createPREvents(pipelineFactory, pipelines, scmConfig, parsed, request) {
    const { username, scmContext, sha, prRef, prNum, changedFiles, branch } = parsed;
    const scm = request.server.app.pipelineFactory.scm;
    const eventFactory = request.server.app.eventFactory;
    const scmDisplayName = scm.getDisplayName({ scmContext });
    const userDisplayName = `${scmDisplayName}:${username}`;
    const events = [];

    for (let i = 0; i < pipelines.length; i += 1) {
        const p = pipelines[i];
        // eslint-disable-next-line no-await-in-loop
        const b = await p.branch;
        const startFrom = (b === branch) ? '~pr' : `~pr:${branch}`;
        // eslint-disable-next-line no-await-in-loop
        const prInfo = await eventFactory.scm.getPrInfo(scmConfig);
        // obtain pipeline's latest commit sha for branch specific job
        // eslint-disable-next-line no-await-in-loop
        const configPipelineSha = await pipelineFactory.scm.getCommitSha(scmConfig);

        const eventConfig = {
            pipelineId: p.id,
            type: 'pr',
            webhooks: true,
            username,
            scmContext,
            sha,
            configPipelineSha,
            prInfo,
            prRef,
            prNum,
            startFrom,
            changedFiles,
            causeMessage: `${parsed.action} by ${userDisplayName}`
        };

        events.push(eventFactory.create(eventConfig));
    }

    return Promise.all(events);
}

/**
 * Create a new job and start the build for an opened pull-request
 * @method  pullRequestOpened
 * @param   {PipelineFactory}   pipelineFactory     The pipeline factory to get the branch list from
 * @param   {Object}            pipelines           The pipelines which has triggered job
 * @param   {Object}            scmConfig           Has the token and scmUri to get branches
 * @param   {Object}            parsed
 * @param   {String}            parsed.hookId       Unique ID for this scm event
 * @param   {String}            parsed.prSource     The origin of this PR
 * @param   {String}            parsed.checkoutUrl  The parsed checkoutUrl
 * @param   {String}            parsed.branch       The branch against which pr is opened
 * @param   {Hapi.request}      request             Request from user
 * @param   {Hapi.reply}        reply               Reply to user
 */
function pullRequestOpened(pipelineFactory, pipelines, scmConfig, parsed, request, reply) {
    const { hookId, prSource, checkoutUrl, branch } = parsed;
    const fullCheckoutUrl = `${checkoutUrl}#${branch}`;

    return pipelineFactory.get({ scmUri: scmConfig.scmUri })
        .then((pipeline) => {
            if (!pipeline) {
                request.log(['webhook', hookId],
                    `Skipping since Pipeline ${fullCheckoutUrl} does not exist`);

                return reply().code(204);
            }

            return pipeline.sync();
        })
        .then((p) => {
            // @TODO Check for cluster-level default
            const restriction = p.annotations['beta.screwdriver.cd/restrict-pr'] || 'none';

            // Check for restriction upfront
            if (isRestrictedPR(restriction, prSource)) {
                request.log(['webhook', hookId],
                    'Skipping build since pipeline is configured to restrict ' +
                    `${restriction} and PR is ${prSource}`);

                return [];
            }

            return createPREvents(pipelineFactory, pipelines, scmConfig, parsed, request);
        })
        .then((events) => {
            if (events.length === 0) {
                return reply().code(204);
            }

            events.forEach((e) => {
                request.log(['webhook', hookId, e.id],
                    `Event ${e.id} started`);
            });

            return reply().code(201);
        })
        .catch(err => reply(boom.wrap(err)));
}

/**
 * Stop any running builds and disable the job for closed pull-request
 * @method  pullRequestClosed
 * @param   {PipelineFactory}   pipelineFactory     The pipeline factory to get the branch list from
 * @param   {Object}            scmConfig           Has the token and scmUri to get branches
 * @param   {Object}            parsed
 * @param   {String}            parsed.hookId       Unique ID for this scm event
 * @param   {String}            parsed.prNum        Pull request number
 * @param   {String}            parsed.checkoutUrl  The parsed checkoutUrl
 * @param   {String}            parsed.branch       The branch against which pr is opened
 * @param   {Hapi.request}      request Request from user
 * @param   {Hapi.reply}        reply   Reply to user
 */
function pullRequestClosed(pipelineFactory, scmConfig, parsed, request, reply) {
    const { hookId, prNum, checkoutUrl, branch } = parsed;
    const jobName = `PR-${prNum}`;
    const fullCheckoutUrl = `${checkoutUrl}#${branch}`;
    const updatePRJobs = (job => stopJob(job)
        .then(() => request.log(['webhook', hookId, job.id], `${job.name} stopped`))
        .then(() => {
            job.archived = true;

            return job.update();
        })
        .then(() => request.log(['webhook', hookId, job.id], `${job.name} disabled and archived`)));

    return pipelineFactory.get({ scmUri: scmConfig.scmUri })
        .then((pipeline) => {
            if (!pipeline) {
                request.log(['webhook', hookId],
                    `Skipping since Pipeline ${fullCheckoutUrl} does not exist`);

                return reply().code(204);
            }

            return pipeline.sync()
                .then(p => p.jobs)
                .then((jobs) => {
                    const prJobs = jobs.filter(j => j.name.includes(jobName));

                    return Promise.all(prJobs.map(j => updatePRJobs(j)));
                });
        })
        .then(() => reply().code(200))
        .catch(err => reply(boom.wrap(err)));
}

/**
 * Stop any running builds and start the build for the synchronized pull-request
 * @method  pullRequestSync
 * @param   {PipelineFactory}   pipelineFactory     The pipeline factory to get the branch list from
 * @param   {Object}            pipelines           The pipelines which has triggered job
 * @param   {Object}            scmConfig           Has the token and scmUri to get branches
 * @param   {Object}            parsed
 * @param   {String}            parsed.hookId       Unique ID for this scm event
 * @param   {String}            parsed.prSource     The origin of this PR
 * @param   {String}            parsed.prNum        Pull request number
 * @param   {String}            parsed.checkoutUrl  The parsed checkoutUrl
 * @param   {String}            parsed.branch       The branch against which pr is opened
 * @param   {Hapi.request}      request             Request from user
 * @param   {Hapi.reply}        reply               Reply to user
 */
function pullRequestSync(pipelineFactory, pipelines, scmConfig, parsed, request, reply) {
    const { hookId, prSource, prNum, checkoutUrl, branch } = parsed;
    const fullCheckoutUrl = `${checkoutUrl}#${branch}`;
    const jobName = `PR-${prNum}`;
    let restriction;

    return pipelineFactory.get({ scmUri: scmConfig.scmUri })
        .then((pipeline) => {
            if (!pipeline) {
                return request.log(['webhook', hookId],
                    `Skipping since Pipeline ${fullCheckoutUrl} does not exist`);
            }

            return pipeline.sync();
        })
        .then((p) => {
            // @TODO Check for cluster-level default
            restriction = p.annotations['beta.screwdriver.cd/restrict-pr'] || 'none';

            return p.jobs;
        })
        .then((jobs) => {
            const prJobs = jobs.filter(j => j.name.includes(jobName));

            // Check for restriction upfront
            if (isRestrictedPR(restriction, prSource)) {
                request.log(['webhook', hookId],
                    'Skipping build since pipeline is configured to restrict ' +
                    `${restriction} and PR is ${prSource}`);

                return [];
            }

            Promise.all(prJobs.map(j => stopJob(j)));
            request.log(['webhook', hookId], `Job(s) for ${jobName} stopped`);

            return createPREvents(pipelineFactory, pipelines, scmConfig, parsed, request);
        })
        .then((events) => {
            if (events.length === 0) {
                return reply().code(204);
            }

            events.forEach((e) => {
                request.log(['webhook', hookId, e.id],
                    `Event ${e.id} started`);
            });

            return reply().code(201);
        })
        .catch(err => reply(boom.wrap(err)));
}

/**
 * Obtains the SCM token for a given user. If a user does not have a valid SCM token registered
 * with Screwdriver, it will use a generic user's token instead.
 * Some SCM services have different thresholds between IP requests and token requests. This is
 * to ensure we have a token to access the SCM service without being restricted by these quotas
 * @method  obtainScmToken
 * @param   {Object}        pluginOptions
 * @param   {String}        pluginOptions.username  Generic scm username
 * @param   {UserFactory}   userFactory             UserFactory object
 * @param   {String}        username                Name of the user that the SCM token is associated with
 * @param   {String}        scmContext              Scm which pipeline's repository exists in
 * @return  {Promise}                               Promise that resolves into a SCM token
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
 * @method  pullRequestEvent
 * @param   {Object}        pluginOptions
 * @param   {String}        pluginOptions.username  Generic scm username
 * @param   {Hapi.request}  request                 Request from user
 * @param   {Hapi.reply}    reply                   Reply to user
 * @param   {Object}        parsed
 */
function pullRequestEvent(pluginOptions, request, reply, parsed) {
    const pipelineFactory = request.server.app.pipelineFactory;
    const userFactory = request.server.app.userFactory;
    const { hookId, action, checkoutUrl, branch,
        prNum, username, scmContext, type } = parsed;
    const fullCheckoutUrl = `${checkoutUrl}#${branch}`;
    const scmConfig = {
        prNum,
        scmUri: '',
        token: '',
        scmContext
    };

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
                request.log(['webhook', hookId],
                    'Skipping since Pipeline triggered by PRs ' +
                    `against ${fullCheckoutUrl} does not exist`);

                return reply().code(204);
            }

            switch (action) {
            case 'opened':
            case 'reopened':
                return pullRequestOpened(pipelineFactory, pipelines,
                    scmConfig, parsed, request, reply);

            case 'synchronized':
                return pullRequestSync(pipelineFactory, pipelines,
                    scmConfig, parsed, request, reply);

            case 'closed':
            default:
                return pullRequestClosed(pipelineFactory, scmConfig, parsed, request, reply);
            }
        })
        .catch(err => reply(boom.wrap(err)));
}

/**
 * Create events for each pipeline
 * @async   createEvents
 * @param   {EventFactory}      eventFactory    To create event
 * @param   {PipelineFactory}   pipelineFactory To use scm module
 * @param   {Array}             pipelines       The pipelines to start events
 * @param   {Object}            parsed          It has information to create event
 * @returns {Promise}                           Promise that resolves into events
 */
async function createEvents(eventFactory, pipelineFactory, pipelines, parsed) {
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
 * @method  pushEvent
 * @param   {Object}        pluginOptions
 * @param   {String}        pluginOptions.username  Generic scm username
 * @param   {Hapi.request}  request                 Request from user
 * @param   {Hapi.reply}    reply                   Reply to user
 * @param   {Object}        parsed                  It has information to create event
 */
function pushEvent(pluginOptions, request, reply, parsed) {
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

            return triggeredPipelines(pipelineFactory, scmConfig, branch, type);
        }).then((pipelines) => {
            if (!pipelines || pipelines.length === 0) {
                request.log(['webhook', hookId],
                    `Skipping since Pipeline ${fullCheckoutUrl} does not exist`);

                return [];
            }

            return createEvents(eventFactory, pipelineFactory, pipelines, parsed);
        })
        .then((events) => {
            if (events.length === 0) {
                return reply().code(204);
            }

            events.forEach((e) => {
                request.log(['webhook', hookId, e.id],
                    `Event ${e.id} started`);
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
 * @method  register
 * @param   {Hapi}      server                  Hapi Server
 * @param   {Object}    options                 Configuration
 * @param   {String}    options.username        Generic scm username
 * @param   {Array}     options.ignoreCommitsBy Ignore commits made by these usernames
 * @param   {Function}  next                    Function to call when done
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
