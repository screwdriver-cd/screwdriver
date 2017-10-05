'use strict';

const boom = require('boom');
const joi = require('joi');

/**
 * Create PR job if not exist, or update PR job if job already exists
 * @method createOrUpdatePRJob
 * @param  {Object}       options
 * @param  {String}       options.hookId        Unique ID for this scm event
 * @param  {String}       options.pipelineId    Identifier for the Pipeline
 * @param  {String}       options.name          Name of the new job (PR-1)
 * @param  {String}       options.sha           Specific SHA1 commit to start the build with
 * @param  {String}       options.username      User who created the PR
 * @param  {String}       options.scmContext    Scm which pipeline's repository exists in
 * @param  {String}       options.prRef         Reference to pull request
 * @param  {Pipeline}     options.pipeline      Pipeline model for the pr
 * @param  {Hapi.request} request               Request from user
 * @param  {Job}          job                   PR Job to update
 * @param  {String}       name                  Job Name ('PR-1' or 'PR-1-component')
 * @param  {Object}       permutations          Job permutations from parsed config
 * @return {Promise}
 */
function createOrUpdatePRJob(options, request, job, name, permutations) {
    const jobFactory = request.server.app.jobFactory;
    const buildFactory = request.server.app.buildFactory;
    const eventFactory = request.server.app.eventFactory;
    const hookId = options.hookId;
    const pipelineId = options.pipelineId;
    const sha = options.sha;
    const username = options.username;
    const scmContext = options.scmContext;
    const prRef = options.prRef;
    const scm = request.server.app.pipelineFactory.scm;
    const scmDisplayName = scm.getDisplayName({ scmContext });
    const userDisplayName = `${scmDisplayName}:${username}`;
    let eventId;

    // Create a single event for these jobs
    return eventFactory.create({
        pipelineId,
        type: 'pr',
        workflow: [name], // remove this after switching to using new workflow
        username,
        scmContext,
        sha,
        causeMessage: `${options.action} by ${userDisplayName}`
    }).then((event) => {
        eventId = event.id;
        // if PR job already exists, update the job
        if (job) {
            job.permutations = permutations;
            job.archived = false;

            return job.update();
        }

        // if the PR is new, create a PR job
        return jobFactory.create({ pipelineId, name, permutations });
    }).then((newJob) => {
        const jobId = newJob.id;

        request.log(['webhook', hookId, jobId], `${name} created`);
        request.log(['webhook', hookId, jobId, pipelineId], `${userDisplayName} selected`);

        // create an event
        return buildFactory.create({
            jobId,
            sha,
            username,
            scmContext,
            eventId,
            prRef
        });
    }).then(build => request.log(
        ['webhook', hookId, build.jobId, build.id], `${name} started ${build.number}`));
}

/**
 * Stop a job by stopping all the builds associated with it
 * If the build is running, set state to ABORTED
 * @method stopJob
 * @param  {Job}    job     Job to stop
 * @return {Promise}
 */
function stopJob(job) {
    if (!job) {
        throw boom.notFound('Job does not exist');
    }

    const stopRunningBuild = (build) => {
        if (build.isDone()) {
            return Promise.resolve();
        }
        build.state = 'ABORTED';

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
 * @param  {String}       options.hookId        Unique ID for this scm event
 * @param  {String}       options.pipelineId    Identifier for the Pipeline
 * @param  {String}       options.name          Name of the new job (PR-1)
 * @param  {String}       options.sha           Specific SHA1 commit to start the build with
 * @param  {String}       options.username      User who created the PR
 * @param  {String}       options.scmContext    Scm which pipeline's repository exists in
 * @param  {String}       options.prRef         Reference to pull request
 * @param  {Pipeline}     options.pipeline      Pipeline model for the pr
 * @param  {Hapi.request} request               Request from user
 * @return {Promise}
 */
function startPRJob(options, request) {
    const prRef = options.prRef;
    const pipeline = options.pipeline;

    return pipeline.getConfiguration(prRef)
        // get configuration for all jobs
        .then(config => Promise.all([config.jobs, pipeline.jobs]))
        .then(([jobsConfig, jobs]) => {
            const hasRequires = Object.keys(jobs).some(jobName => jobs[jobName].requires);
            const jobNamesArray = jobs.map(j => j.name);
            let jobName = options.name;
            let jobIndex;

            // OLD WORKFLOW DESIGN
            if (!hasRequires) {
                jobIndex = jobNamesArray.indexOf(jobName);

                return createOrUpdatePRJob(
                    options, request, jobs[jobIndex], jobName, jobsConfig.main);
            }

            // NEW WORKFLOW DESIGN
            const prJobs = jobs.filter(j => j.requires && j.requires.includes('~pr'));

            return Promise.all(prJobs.map((j) => {
                jobName = `${jobName}-${j.name}`;
                jobIndex = jobNamesArray.indexOf(jobName);

                return createOrUpdatePRJob(
                    options, request, jobs[jobIndex], jobName, jobsConfig[j.name]);
            }));
        });
}

/**
 * Create a new job and start the build for an opened pull-request
 * @method pullRequestOpened
 * @param  {Object}       options
 * @param  {String}       options.hookId        Unique ID for this scm event
 * @param  {String}       options.name          Name of the new job (PR-1)
 * @param  {Hapi.request} request               Request from user
 * @param  {Hapi.reply}   reply                 Reply to user
 */
function pullRequestOpened(options, request, reply) {
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
 * @param  {String}       options.jobId      Identifier for the Job
 * @param  {String}       options.name       Name of the job (PR-1)
 * @param  {Hapi.request} request Request from user
 * @param  {Hapi.reply}   reply   Reply to user
 */
function pullRequestClosed(options, request, reply) {
    const jobFactory = request.server.app.jobFactory;
    const hookId = options.hookId;
    const jobId = options.jobId;
    const name = options.name;

    return jobFactory.get(jobId)
        .then(job =>
            stopJob(job)
                .then(() => request.log(['webhook', hookId, jobId], `${name} stopped`))
            // disable and archive the job
                .then(() => {
                    job.state = 'DISABLED';
                    job.archived = true;

                    return job.update();
                })
            // log some stuff
                .then(() => {
                    request.log(['webhook', hookId, jobId], `${name} disabled and archived`);

                    return reply().code(200);
                }))
        // something went wrong
        .catch(err => reply(boom.wrap(err)));
}

/**
 * Stop any running builds and start the build for the synchronized pull-request
 * @method pullRequestSync
 * @param  {Object}       options
 * @param  {String}       options.hookId        Unique ID for this scm event
 * @param  {String}       options.pipelineId    Identifier for the Pipeline
 * @param  {String}       options.jobId         Identifier for the Job
 * @param  {String}       options.name          Name of the job (PR-1)
 * @param  {String}       options.sha           Specific SHA1 commit to start the build with
 * @param  {String}       options.username      User who created the PR
 * @param  {String}       options.scmContext    Scm which pipeline's repository exists in
 * @param  {String}       options.prRef         Reference to pull request
 * @param  {Pipeline}     options.pipeline      Pipeline model for the pr
 * @param  {Hapi.request} request               Request from user
 * @param  {Hapi.reply}   reply                 Reply to user
 */
function pullRequestSync(options, request, reply) {
    const jobFactory = request.server.app.jobFactory;
    const hookId = options.hookId;
    const name = options.name;
    const jobId = options.jobId;

    return jobFactory.get(jobId)
        .then(job => stopJob(job))
        .then(() => request.log(['webhook', hookId, jobId], `${name} stopped`))
        .then(() => startPRJob(options, request))
        .then(() => {
            request.log(['webhook', hookId, jobId], `${name} synced`);

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
 */
function pullRequestEvent(pluginOptions, request, reply, parsed) {
    const pipelineFactory = request.server.app.pipelineFactory;
    const userFactory = request.server.app.userFactory;
    const hookId = parsed.hookId;
    const action = parsed.action;
    const prNumber = parsed.prNum;
    const repository = parsed.checkoutUrl;
    const branch = parsed.branch;
    const checkoutUrl = `${repository}#${branch}`;
    const prRef = parsed.prRef;
    const sha = parsed.sha;
    const username = parsed.username;
    const scmContext = parsed.scmContext;

    request.log(['webhook', hookId], `PR #${prNumber} ${action} for ${checkoutUrl}`);

    // Fetch the pipeline associated with this hook
    return obtainScmToken(pluginOptions, userFactory, username, scmContext)
        .then(token => pipelineFactory.scm.parseUrl({ checkoutUrl, token, scmContext }))
        .then(scmUri => pipelineFactory.get({ scmUri }))
        .then((pipeline) => {
            if (!pipeline) {
                request.log(['webhook', hookId],
                    `Skipping since Pipeline ${checkoutUrl} does not exist`);

                return reply().code(204);
            }

            return pipeline.sync()
                // handle the PR action
                .then(p => p.jobs.then((jobs) => {
                    const pipelineId = p.id;
                    const name = `PR-${prNumber}`;
                    const options = {
                        hookId,
                        pipelineId,
                        name,
                        sha,
                        username,
                        scmContext,
                        prRef,
                        pipeline: p,
                        action: action.charAt(0).toUpperCase() + action.slice(1)
                    };
                    const i = jobs.findIndex(j => j.name === name);

                    if (i > -1) {
                        options.jobId = jobs[i].id;
                    }

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
                }
                ));
        })
        .catch(err => reply(boom.wrap(err)));
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
    const pipelineFactory = request.server.app.pipelineFactory;
    const buildFactory = request.server.app.buildFactory;
    const userFactory = request.server.app.userFactory;
    const eventFactory = request.server.app.eventFactory;
    const hookId = parsed.hookId;
    const repository = parsed.checkoutUrl;
    const branch = parsed.branch;
    const sha = parsed.sha;
    const username = parsed.username;
    const scmContext = parsed.scmContext;
    const checkoutUrl = `${repository}#${branch}`;

    request.log(['webhook', hookId], `Push for ${checkoutUrl}`);

    // Fetch the pipeline associated with this hook
    return obtainScmToken(pluginOptions, userFactory, username, scmContext)
        .then(token => pipelineFactory.scm.parseUrl({ checkoutUrl, token, scmContext }))
        .then(scmUri => pipelineFactory.get({ scmUri }))
        .then((pipeline) => {
            if (!pipeline) {
                request.log(['webhook', hookId],
                    `Skipping since Pipeline ${checkoutUrl} does not exist`);

                return reply().code(204);
            }

            return pipeline.sync()
                // handle the PR action
                .then(p => p.jobs.then((jobs) => {
                    const pipelineId = p.id;
                    const name = 'main';
                    const i = jobs.findIndex(j => j.name === name); // get job's index
                    const jobId = jobs[i].id;

                    // create an event
                    return eventFactory.create({
                        pipelineId,
                        type: 'pipeline',
                        workflow: pipeline.workflow,
                        username,
                        scmContext,
                        sha,
                        causeMessage: `Merged by ${username}`
                    })
                        // create a build
                        .then(event =>
                            buildFactory.create(
                                { jobId, sha, username, scmContext, eventId: event.id })
                        )
                        // log build created
                        .then((build) => {
                            request.log(['webhook', hookId, jobId, build.id],
                                `${name} started ${build.number}`);

                            return reply().code(201);
                        });
                }));
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
            handler: (request, reply) =>
                scm.parseHook(request.headers, request.payload)
                    .then((parsed) => {
                        if (!parsed) { // for all non-matching events or actions
                            return reply().code(204);
                        }

                        const eventType = parsed.type;
                        const hookId = parsed.hookId;
                        const username = parsed.username;
                        const ignoreUser = pluginOptions.ignoreCommitsBy;

                        request.log(['webhook', hookId], `Received event type ${eventType}`);

                        if (/\[(skip ci|ci skip)\]/.test(parsed.lastCommitMessage)) {
                            request.log(['webhook', hookId], 'Skipping due to the commit message');

                            return reply().code(204);
                        }

                        if (ignoreUser.includes(username)) {
                            request.log(['webhook', hookId],
                                `Skipping because user ${username} is ignored`);

                            return reply().code(204);
                        }

                        if (eventType === 'pr') {
                            return pullRequestEvent(pluginOptions, request, reply, parsed);
                        }

                        return pushEvent(pluginOptions, request, reply, parsed);
                    })
                    .catch(err => reply(boom.wrap(err)))
        }
    });

    next();
};

exports.register.attributes = {
    name: 'webhooks'
};
