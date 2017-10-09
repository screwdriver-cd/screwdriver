'use strict';

const boom = require('boom');
const joi = require('joi');

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
 * @param  {String}       options.username      User who created the PR
 * @param  {String}       options.scmContext    Scm which pipeline's repository exists in
 * @param  {String}       options.sha           Specific SHA1 commit to start the build with
 * @param  {String}       options.prRef         Reference to pull request
 * @param  {String}       options.prNum         Pull request number
 * @param  {Pipeline}     options.pipeline      Pipeline model for the pr
 * @param  {Hapi.request} request               Request from user
 * @return {Promise}
 */
function startPRJob(options, request) {
    const { name, username, scmContext, sha, prRef, prNum, pipeline } = options;
    const scm = request.server.app.pipelineFactory.scm;
    const eventFactory = request.server.app.eventFactory;
    const scmDisplayName = scm.getDisplayName({ scmContext });
    const userDisplayName = `${scmDisplayName}:${username}`;

    return pipeline.jobs
        .then((jobs) => {
            const eventConfig = {
                pipelineId: pipeline.id,
                type: 'pr',
                workflow: [name], // change this after switching to using new workflow,
                username,
                scmContext,
                sha,
                prRef,
                prNum,
                causeMessage: `${options.action} by ${userDisplayName}`
            };
            const hasRequires = Object.keys(jobs).some(jobName => jobs[jobName].requires);

            // NEW WORKFLOW DESIGN
            if (hasRequires) {
                eventConfig.startFrom = '~pr';
            }

            return eventFactory.create(eventConfig);
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
 * @param  {Pipeline}     options.pipeline   Pipeline model for the pr
 * @param  {String}       options.name       Name of the job (PR-1) or (PR-1-main)
 * @param  {Hapi.request} request Request from user
 * @param  {Hapi.reply}   reply   Reply to user
 */
function pullRequestClosed(options, request, reply) {
    const { pipeline, hookId, name } = options;
    const updatePRJobs = (job => stopJob(job)
        .then(() => request.log(['webhook', hookId, job.id], `${job.name} stopped`))
        .then(() => {
            job.state = 'DISABLED';
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
 * @param  {String}       options.prRef         Reference to pull request
 * @param  {Pipeline}     options.pipeline      Pipeline model for the pr
 * @param  {Hapi.request} request               Request from user
 * @param  {Hapi.reply}   reply                 Reply to user
 */
function pullRequestSync(options, request, reply) {
    const { pipeline, hookId, name } = options;
    let prJobs;

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
 */
function pullRequestEvent(pluginOptions, request, reply, parsed) {
    const pipelineFactory = request.server.app.pipelineFactory;
    const userFactory = request.server.app.userFactory;
    const { hookId, action, prNum, checkoutUrl, branch, prRef, sha, username, scmContext } = parsed;
    const fullCheckoutUrl = `${checkoutUrl}#${branch}`;

    request.log(['webhook', hookId], `PR #${prNum} ${action} for ${fullCheckoutUrl}`);

    // Fetch the pipeline associated with this hook
    return obtainScmToken(pluginOptions, userFactory, username, scmContext)
        .then(token => pipelineFactory.scm.parseUrl({ fullCheckoutUrl, token, scmContext }))
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
                    const options = {
                        pipelineId: p.id,
                        name: `PR-${prNum}`,
                        hookId,
                        sha,
                        username,
                        scmContext,
                        prRef,
                        prNum,
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
                });
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
    const { hookId, checkoutUrl, branch, sha, username, scmContext } = parsed;
    const fullCheckoutUrl = `${checkoutUrl}#${branch}`;

    request.log(['webhook', hookId], `Push for ${fullCheckoutUrl}`);

    // Fetch the pipeline associated with this hook
    return obtainScmToken(pluginOptions, userFactory, username, scmContext)
        .then(token => pipelineFactory.scm.parseUrl({ fullCheckoutUrl, token, scmContext }))
        .then(scmUri => pipelineFactory.get({ scmUri }))
        .then((pipeline) => {
            if (!pipeline) {
                request.log(['webhook', hookId],
                    `Skipping since Pipeline ${fullCheckoutUrl} does not exist`);

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

                        const { type, hookId, username } = parsed;
                        const ignoreUser = pluginOptions.ignoreCommitsBy;

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

                        if (type === 'pr') {
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
