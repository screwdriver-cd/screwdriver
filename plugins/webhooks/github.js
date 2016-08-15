/* eslint no-param-reassign: ["error", { "props": false }] */
'use strict';
const githubWebhooks = require('hapi-github-webhooks');
const hoek = require('hoek');
const boom = require('boom');
let API_URI;

/**
 * Create a new job and start the build for an opened pull-request
 * @method pullRequestOpened
 * @param  {Object}       options
 * @param  {String}       options.eventId    Unique ID for this GitHub event
 * @param  {String}       options.pipelineId Identifier for the Pipeline
 * @param  {String}       options.name       Name of the new job (PR-1)
 * @param  {String}       [options.sha]      specific SHA1 commit to start the build with
 * @param  {String}       options.username   User who created the PR
 * @param  {Hapi.request} request Request from user
 * @param  {Hapi.reply}   reply   Reply to user
 */
function pullRequestOpened(options, request, reply) {
    const jobFactory = request.server.settings.app.jobFactory;
    const buildFactory = request.server.settings.app.buildFactory;
    const eventId = options.eventId;
    const pipelineId = options.pipelineId;
    const name = options.name;
    const sha = options.sha;
    const username = options.username;

    // create a new job
    return jobFactory.create({ pipelineId, name })
        // log stuff
        .then(job => {
            request.log(['webhook-github', eventId, job.id], `${job.name} created`);
            request.log([
                'webhook-github',
                eventId,
                job.id,
                pipelineId
            ], `${username} selected`);

            return job.id;
        })
        // create a build
        .then(jobId => {
            const apiUri = API_URI || request.server.info.uri;
            const tokenGen = (buildId) =>
                request.server.plugins.login.generateToken(buildId, ['build']);

            return buildFactory.create({ jobId, sha, username, apiUri, tokenGen });
        })
        // log the build created/started
        .then(build => {
            request.log(['webhook-github', eventId, build.jobId, build.id], `${name} started `
                + `${build.number}`);
        })
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
    const jobFactory = request.server.settings.app.jobFactory;
    const buildFactory = request.server.settings.app.buildFactory;
    const eventId = options.eventId;
    const jobId = options.jobId;
    const name = options.name;

    // fetch the builds to stop, and the job to update
    return Promise.all([
        buildFactory.getBuildsForJobId({ jobId }), // someday this should just be job.builds
        jobFactory.get(jobId)
    ])
    .then(([builds, job]) =>
        // stop all running builds
        Promise.all(builds.map(b => b.stop()))
            // disable the job
            .then(() => {
                // no job to update?
                if (!job) {
                    throw boom.notFound('Job does not exist');
                }

                job.state = 'DISABLED';

                return job.update();
            })
    )
    // log some stuff
    .then(() => {
        request.log(['webhook-github', eventId, jobId], `${name} disabled`);

        return reply().code(200);
    })
    // something went wrong
    .catch(err => reply(boom.wrap(err)));
}

/**
 * Stop any running builds and start the build for the synchronized pull-request
 * @method pullRequestSync
 * @param  {Object}       options
 * @param  {String}       options.eventId    Unique ID for this GitHub event
 * @param  {String}       options.jobId      Identifier for the Job
 * @param  {String}       options.name       Name of the job (PR-1)
 * @param  {String}       options.username   User who created the PR
 * @param  {Hapi.request} request Request from user
 * @param  {Hapi.reply}   reply   Reply to user
 */
function pullRequestSync(options, request, reply) {
    const buildFactory = request.server.settings.app.buildFactory;
    const eventId = options.eventId;
    const name = options.name;
    const username = options.username;
    const jobId = options.jobId;

    return buildFactory.getBuildsForJobId({ jobId })
        // stop all running builds
        .then(builds => Promise.all(builds.map(b => b.stop())))
        // log build stoppage
        .then(() => {
            request.log(['webhook-github', eventId, jobId], `${name} stopped`);
        })
        // create a new build
        .then(() => buildFactory.create({ jobId, username }))
        // log build created
        .then(build => {
            request.log(['webhook-github', eventId, jobId, build.id],
                `${name} started ${build.number}`);
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
    const pipelineFactory = request.server.settings.app.pipelineFactory;
    const jobFactory = request.server.settings.app.jobFactory;
    const eventId = request.headers['x-github-delivery'];
    const payload = request.payload;
    const action = hoek.reach(payload, 'action');
    const prNumber = hoek.reach(payload, 'pull_request.number');
    const repository = hoek.reach(payload, 'pull_request.base.repo.ssh_url');
    const branch = hoek.reach(payload, 'pull_request.base.ref');
    const scmUrl = `${repository}#${branch}`;
    const sha = hoek.reach(payload, 'pull_request.head.sha');
    const username = hoek.reach(payload, 'pull_request.user.login');

    request.log(['webhook-github', eventId], `PR #${prNumber} ${action} for ${scmUrl}`);

    // Possible actions
    // "opened", "closed", "reopened", "synchronize",
    // "assigned", "unassigned", "labeled", "unlabeled", "edited"

    // Fetch the pipeline associated with this hook
    return pipelineFactory.get({ scmUrl })
        .then(pipeline => {
            if (!pipeline) {
                throw boom.notFound('Pipeline does not exist');
            }

            // sync the pipeline ... reasons why will become clear later???
            return pipeline.sync()
                // handle the PR action
                .then(() => {
                    const pipelineId = pipeline.id;
                    const name = `PR-${prNumber}`;
                    const jobId = jobFactory.generateId({ pipelineId, name });

                    switch (action) {
                    case 'opened':
                    case 'reopened':
                        return pullRequestOpened({
                            eventId,
                            pipelineId,
                            name,
                            sha,
                            username
                        }, request, reply);

                    case 'synchronize':
                        return pullRequestSync({
                            eventId,
                            jobId,
                            name,
                            username
                        }, request, reply);

                    case 'closed':
                        return pullRequestClosed({
                            eventId,
                            jobId,
                            pipelineId,
                            name
                        }, request, reply);

                    default:
                        // Ignore other actions
                        return reply().code(204);
                    }
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
 * @param  {String}         options.password  Login password
 * @param  {String}         options.apiUri    Server to contact for notifications
 * @param  {Function}       next
 */
module.exports = (server, options) => {
    // Register the hook interface
    server.register(githubWebhooks);
    // Add the auth strategy
    server.auth.strategy('githubwebhook', 'githubwebhook', {
        secret: options.secret
    });
    API_URI = options.apiUri;

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
                default:
                    return reply(boom.badRequest(`Event ${eventType} not supported`));
                }
            }
        }
    };
};
