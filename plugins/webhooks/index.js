'use strict';

const boom = require('boom');

const GENERIC_SCM_USER = 'sd-buildbot';

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
 * @param  {String}       options.prRef         Reference to pull request
 * @param  {Pipeline}     options.pipeline      Pipeline model for the pr
 * @param  {Hapi.request} request               Request from user
 * @return {Promise}
 */
function startPRJob(options, request) {
    const jobFactory = request.server.app.jobFactory;
    const buildFactory = request.server.app.buildFactory;
    const eventFactory = request.server.app.eventFactory;
    const hookId = options.hookId;
    const pipelineId = options.pipelineId;
    const jobId = options.jobId;
    const name = options.name;
    const sha = options.sha;
    const username = options.username;
    const prRef = options.prRef;
    const pipeline = options.pipeline;

    return pipeline.getConfiguration(prRef)
        // get permutations(s) for "main" job
        .then(config => config.jobs.main)
        // create a new job
        .then(permutations => jobFactory.create({ pipelineId, name, permutations }))
        // log stuff
        .then((job) => {
            request.log(['webhook', hookId, jobId], `${name} created`);
            request.log([
                'webhook',
                hookId,
                jobId,
                pipelineId
            ], `${username} selected`);

            // create an event
            return eventFactory.create({
                pipelineId,
                type: 'pr',
                workflow: [job.name],
                username,
                sha,
                causeMessage: `${options.action} by ${username}`
            });
        })
        // create a build
        .then(event => buildFactory.create({ jobId, sha, username, eventId: event.id, prRef }))
        .then(build =>
            request.log(['webhook', hookId, build.jobId, build.id],
            `${name} started ${build.number}`));
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
        .then(() => startPRJob(options, request))
        // log build created
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
 * @param  {UserFactory}       userFactory UserFactory object
 * @param  {String}            username    Name of the user that the SCM token is associated with
 * @return {Promise}                       Promise that resolves into a SCM token
 */
function obtainScmToken(userFactory, username) {
    return userFactory.get({ username })
        .then((user) => {
            if (!user) {
                return userFactory.get({ username: GENERIC_SCM_USER })
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
 * @param  {Hapi.request}       request Request from user
 * @param  {Hapi.reply}         reply   Reply to user
 */
function pullRequestEvent(request, reply, parsed) {
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

    request.log(['webhook', hookId], `PR #${prNumber} ${action} for ${checkoutUrl}`);

    // Fetch the pipeline associated with this hook
    return obtainScmToken(userFactory, username)
        .then(token => pipelineFactory.scm.parseUrl({ checkoutUrl, token }))
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
                    const i = jobs.findIndex(j => j.name === name);   // get job's index
                    const jobId = jobs[i].id;
                    const options = {
                        hookId,
                        pipelineId,
                        jobId,
                        name,
                        sha,
                        username,
                        prRef,
                        pipeline: p,
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
                }
            ));
        })
        .catch(err => reply(boom.wrap(err)));
}

/**
 * Act on a Push event
 *  - Should start a new main job
 * @method pushEvent
 * @param  {Hapi.request}       request Request from user
 * @param  {Hapi.reply}         reply   Reply to user
 */
function pushEvent(request, reply, parsed) {
    const pipelineFactory = request.server.app.pipelineFactory;
    const buildFactory = request.server.app.buildFactory;
    const userFactory = request.server.app.userFactory;
    const eventFactory = request.server.app.eventFactory;
    const hookId = parsed.hookId;
    const repository = parsed.checkoutUrl;
    const branch = parsed.branch;
    const sha = parsed.sha;
    const username = parsed.username;
    const checkoutUrl = `${repository}#${branch}`;

    request.log(['webhook', hookId], `Push for ${checkoutUrl}`);

    // Fetch the pipeline associated with this hook
    return obtainScmToken(userFactory, username)
        .then(token => pipelineFactory.scm.parseUrl({ checkoutUrl, token }))
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
                    const i = jobs.findIndex(j => j.name === name);   // get job's index
                    const jobId = jobs[i].id;

                    // create an event
                    return eventFactory.create({
                        pipelineId,
                        type: 'pipeline',
                        workflow: pipeline.workflow,
                        username,
                        sha,
                        causeMessage: `Merged by ${username}`
                    })
                    // create a build
                    .then(event => buildFactory.create({ jobId, sha, username, eventId: event.id }))
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
 * @param  {Hapi}       server            Hapi Server
 * @param  {Object}     options           Configuration
 * @param  {Function}   next              Function to call when done
 */
exports.register = (server, options, next) => {
    const scm = server.root.app.pipelineFactory.scm;

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

                    request.log(['webhook', hookId], `Received event type ${eventType}`);

                    if (eventType === 'pr') {
                        return pullRequestEvent(request, reply, parsed);
                    }

                    return pushEvent(request, reply, parsed);
                })
                .catch(err => reply(boom.wrap(err)))
        }
    });

    next();
};

exports.register.attributes = {
    name: 'webhooks'
};
