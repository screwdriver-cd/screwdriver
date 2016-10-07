/* eslint no-param-reassign: ["error", { "props": false }] */
'use strict';
const githubWebhooks = require('hapi-github-webhooks');
const hoek = require('hoek');
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
            request.log(['webhook-github', eventId, jobId], `${name} created`);
            request.log([
                'webhook-github',
                eventId,
                jobId,
                pipelineId
            ], `${username} selected`);
        })
        // create a build
        .then(() => buildFactory.create({ jobId, sha, username }))
        .then(build =>
            request.log(['webhook-github', options.eventId, build.jobId, build.id],
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
            .then(() => request.log(['webhook-github', eventId, jobId], `${name} stopped`))
            // disable and archive the job
            .then(() => {
                job.state = 'DISABLED';
                job.archived = true;

                return job.update();
            })
            // log some stuff
            .then(() => {
                request.log(['webhook-github', eventId, jobId], `${name} disabled and archived`);

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
            request.log(['webhook-github', eventId, jobId], `${name} synced`);

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
function pullRequestEvent(request, reply) {
    const pipelineFactory = request.server.app.pipelineFactory;
    const jobFactory = request.server.app.jobFactory;
    const eventId = request.headers['x-github-delivery'];
    const payload = request.payload;
    const action = hoek.reach(payload, 'action');
    const prNumber = hoek.reach(payload, 'pull_request.number');
    const repository = hoek.reach(payload, 'pull_request.base.repo.ssh_url');
    const branch = hoek.reach(payload, 'pull_request.base.ref');
    const scmUrl = `${repository}#${branch}`;
    const prRef = `${repository}#pull/${prNumber}/merge`;
    const sha = hoek.reach(payload, 'pull_request.head.sha');
    const username = hoek.reach(payload, 'pull_request.user.login');

    request.log(['webhook-github', eventId], `PR #${prNumber} ${action} for ${scmUrl}`);

    // Possible actions
    // "opened", "closed", "reopened", "synchronize",
    // "assigned", "unassigned", "labeled", "unlabeled", "edited"
    if (!['opened', 'reopened', 'synchronize', 'closed'].includes(action)) {
        return reply().code(204);
    }

    // Fetch the pipeline associated with this hook
    return pipelineFactory.get({ scmUrl })
        .then(pipeline => {
            if (!pipeline) {
                request.log(['webhook-github', eventId],
                    `Skipping since Pipeline ${scmUrl} does not exist`);

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

                    case 'synchronize':
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
function pushEvent(request, reply) {
    const pipelineFactory = request.server.app.pipelineFactory;
    const jobFactory = request.server.app.jobFactory;
    const buildFactory = request.server.app.buildFactory;
    const eventId = request.headers['x-github-delivery'];
    const payload = request.payload;
    const repository = hoek.reach(payload, 'repository.ssh_url');
    const branch = hoek.reach(payload, 'ref').replace(/^refs\/heads\//, '');
    const sha = hoek.reach(payload, 'after');
    const username = hoek.reach(payload, 'sender.login');
    const scmUrl = `${repository}#${branch}`;

    request.log(['webhook-github', eventId], `Push for ${scmUrl}`);

    // Fetch the pipeline associated with this hook
    return pipelineFactory.get({ scmUrl })
        .then(pipeline => {
            if (!pipeline) {
                request.log(['webhook-github', eventId],
                    `Skipping since Pipeline ${scmUrl} does not exist`);

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
                        .then(build => {
                            request.log(['webhook-github', eventId, jobId, build.id],
                                `${name} started ${build.number}`);

                            return reply().code(201);
                        });
                });
        })
        .catch(err => reply(boom.wrap(err)));
}

/**
 * GitHub Webhook Plugin
 *  - Validates that the event came from GitHub
 *  - Opening a PR should sync the pipeline (creating the job) and start the new PR job
 *  - Syncing a PR should stop the existing PR job and start a new one
 *  - Closing a PR should stop the PR job and sync the pipeline (disabling the job)
 * @method github
 * @param  {Hapi.Server}    server
 * @param  {Object}         options
 * @param  {String}         options.secret    GitHub Webhook secret to sign payloads with
 * @param  {Function}       next
 */
module.exports = (server, options) => {
    // Register the hook interface
    server.register(githubWebhooks);
    // Add the auth strategy
    server.auth.strategy('githubwebhook', 'githubwebhook', {
        secret: options.secret
    });

    // Now use it
    return {
        method: 'POST',
        path: '/webhooks/github',
        config: {
            description: 'Handle events from GitHub',
            notes: 'Acts on pull request, pushes, comments, etc.',
            tags: ['api', 'github', 'webhook'],
            auth: {
                strategies: ['githubwebhook'],
                payload: 'required'
            },
            handler: (request, reply) => {
                const eventType = request.headers['x-github-event'];
                const eventId = request.headers['x-github-delivery'];

                request.log(['webhook-github', eventId], `Received event ${eventType}`);

                switch (eventType) {
                case 'ping':
                    return reply().code(204);
                case 'pull_request':
                    return pullRequestEvent(request, reply);
                case 'push':
                    return pushEvent(request, reply);
                default:
                    return reply(boom.badRequest(`Event ${eventType} not supported`));
                }
            }
        }
    };
};
