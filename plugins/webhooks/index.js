'use strict';

const boom = require('boom');

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
 * @param  {String}       options.eventId       Unique ID for this GitHub event
 * @param  {String}       options.pipelineId    Identifier for the Pipeline
 * @param  {String}       options.name          Name of the new job (PR-1)
 * @param  {String}       [options.sha]         specific SHA1 commit to start the build with
 * @param  {String}       options.username      User who created the PR
 * @param  {String}       options.prRef         Reference to pull request
 * @param  {Pipeline}     options.pipeline      Pipeline model for the pr
 * @param  {Hapi.request} request               Request from user
 * @return {Promise}
 */
function startPRJob(options, request) {
    const jobFactory = request.server.app.jobFactory;
    const buildFactory = request.server.app.buildFactory;
    const eventId = options.eventId;
    const pipelineId = options.pipelineId;
    const jobId = options.jobId;
    const name = options.name;
    const sha = options.sha;
    const username = options.username;
    const ref = options.prRef;
    const pipeline = options.pipeline;

    return pipeline.getConfiguration(ref)
        // get permutations(s) for "main" job
        .then(config => config.jobs.main)
        // create a new job
        .then(permutations => jobFactory.create({ pipelineId, name, permutations }))
        // log stuff
        .then(() => {
            request.log(['webhook', eventId, jobId], `${name} created`);
            request.log([
                'webhook',
                eventId,
                jobId,
                pipelineId
            ], `${username} selected`);
        })
        // create a build
        .then(() => buildFactory.create({ jobId, sha, username }))
        .then(build =>
            request.log(['webhook', options.eventId, build.jobId, build.id],
            `${name} started ${build.number}`));
}

/**
 * Create a new job and start the build for an opened pull-request
 * @method pullRequestOpened
 * @param  {Object}       options
 * @param  {String}       options.eventId       Unique ID for this GitHub event
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
 * @param  {String}       options.eventId    Unique ID for this GitHub event
 * @param  {String}       options.pipelineId Identifier for the Pipeline
 * @param  {String}       options.jobId      Identifier for the Job
 * @param  {String}       options.name       Name of the job (PR-1)
 * @param  {Hapi.request} request Request from user
 * @param  {Hapi.reply}   reply   Reply to user
 */
function pullRequestClosed(options, request, reply) {
    const jobFactory = request.server.app.jobFactory;
    const eventId = options.eventId;
    const jobId = options.jobId;
    const name = options.name;

    return jobFactory.get(jobId)
        .then(job =>
            stopJob(job)
            .then(() => request.log(['webhook', eventId, jobId], `${name} stopped`))
            // disable and archive the job
            .then(() => {
                job.state = 'DISABLED';
                job.archived = true;

                return job.update();
            })
            // log some stuff
            .then(() => {
                request.log(['webhook', eventId, jobId], `${name} disabled and archived`);

                return reply().code(200);
            }))
        // something went wrong
        .catch(err => reply(boom.wrap(err)));
}

/**
 * Stop any running builds and start the build for the synchronized pull-request
 * @method pullRequestSync
 * @param  {Object}       options
 * @param  {String}       options.eventId       Unique ID for this GitHub event
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
    const eventId = options.eventId;
    const name = options.name;
    const jobId = options.jobId;

    return jobFactory.get(jobId)
        .then(job => stopJob(job))
        .then(() => startPRJob(options, request))
        // log build created
        .then(() => {
            request.log(['webhook', eventId, jobId], `${name} synced`);

            return reply().code(201);
        })
        // oops. something went wrong
        .catch(err => reply(boom.wrap(err)));
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
    const jobFactory = request.server.app.jobFactory;
    const userFactory = request.server.app.userFactory;
    const eventId = parsed.hookId;
    const action = parsed.action;
    const prNumber = parsed.prNum;
    const repository = parsed.checkoutUrl;
    const branch = parsed.branch;
    const checkoutUrl = `${repository}#${branch}`;
    const prRef = parsed.prRef;
    const sha = parsed.sha;
    const username = parsed.username;

    request.log(['webhook', eventId], `PR #${prNumber} ${action} for ${checkoutUrl}`);

    // Fetch the pipeline associated with this hook
    return userFactory.get({ username })
        .then(user => user.unsealToken())
        .then(token => pipelineFactory.scm.parseUrl({ checkoutUrl, token }))
        .then(scmUri => pipelineFactory.get({ scmUri }))
        .then((pipeline) => {
            if (!pipeline) {
                request.log(['webhook', eventId],
                    `Skipping since Pipeline ${checkoutUrl} does not exist`);

                return reply().code(204);
            }

            // sync the pipeline ... reasons why will become clear later???
            return pipeline.sync()
                // handle the PR action
                .then(() => {
                    const pipelineId = pipeline.id;
                    const name = `PR-${prNumber}`;
                    const jobId = jobFactory.generateId({ pipelineId, name });
                    const options = {
                        eventId,
                        pipelineId,
                        jobId,
                        name,
                        sha,
                        username,
                        prRef,
                        pipeline
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
 * Act on a Push event
 *  - Should start a new main job
 * @method pushEvent
 * @param  {Hapi.request}       request Request from user
 * @param  {Hapi.reply}         reply   Reply to user
 */
function pushEvent(request, reply, parsed) {
    const pipelineFactory = request.server.app.pipelineFactory;
    const jobFactory = request.server.app.jobFactory;
    const buildFactory = request.server.app.buildFactory;
    const userFactory = request.server.app.userFactory;
    const eventId = parsed.hookId;
    const repository = parsed.checkoutUrl;
    const branch = parsed.branch;
    const sha = parsed.sha;
    const username = parsed.username;
    const checkoutUrl = `${repository}#${branch}`;

    request.log(['webhook', eventId], `Push for ${checkoutUrl}`);

    // Fetch the pipeline associated with this hook
    return userFactory.get({ username })
        .then(user => user.unsealToken())
        .then(token => pipelineFactory.scm.parseUrl({ checkoutUrl, token }))
        .then(scmUri => pipelineFactory.get({ scmUri }))
        .then((pipeline) => {
            if (!pipeline) {
                request.log(['webhook', eventId],
                    `Skipping since Pipeline ${checkoutUrl} does not exist`);

                return reply().code(204);
            }

            // sync the pipeline to get the latest jobs
            return pipeline.sync()
                // handle the PR action
                .then(() => {
                    const pipelineId = pipeline.id;
                    const name = 'main';
                    const jobId = jobFactory.generateId({ pipelineId, name });

                    return buildFactory.create({ jobId, sha, username })
                        // log build created
                        .then((build) => {
                            request.log(['webhook', eventId, jobId, build.id],
                                `${name} started ${build.number}`);

                            return reply().code(201);
                        });
                });
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
                    const eventId = parsed.hookId;

                    request.log(['webhook', eventId], `Received event type ${eventType}`);

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
