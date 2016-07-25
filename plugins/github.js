'use strict';
const githubWebhooks = require('hapi-github-webhooks');
const hoek = require('hoek');
const boom = require('boom');
const Models = require('screwdriver-models');
let Pipeline;

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
    const eventId = request.headers['x-github-delivery'];
    const payload = request.payload;
    const action = hoek.reach(payload, 'action');
    const prNumber = hoek.reach(payload, 'pull_request.number');
    const repository = hoek.reach(payload, 'pull_request.base.repo.ssh_url');
    const branch = hoek.reach(payload, 'pull_request.base.ref');
    const scmUrl = `${repository}#${branch}`;

    request.log(['webhook-github', eventId], `PR #${prNumber} ${action} for ${scmUrl}`);

    // Possible actions
    // "opened", "closed", "reopened", "synchronize"
    // @TODO ignore events from "assigned", "unassigned", "labeled", "unlabeled", "edited"
    Pipeline.sync({ scmUrl }, (err, data) => {
        if (err) {
            return reply(boom.wrap(err));
        }
        if (!data) {
            return reply(boom.notFound('Pipeline does not exist'));
        }

        // @TODO copy from main
        // @TODO create & start job if opened
        // @TODO stop & start job if sync
        // @TODO disable & stop job if closed

        return reply().code(204);
    });
}

/**
 * GitHub Webhook Plugin
 *  - Validates that the event came from GitHub
 *  - Opening a PR should sync the pipeline (creating the job) and start the new PR job
 *  - Syncing a PR should stop the existing PR job and start a new one
 *  - Closing a PR should stop the PR job and sync the pipeline (disabling the job)
 * @method register
 * @param  {Hapi.Server}    server
 * @param  {Object}         options
 * @param  {Object}         options.datastore Datastore Model
 * @param  {String}         options.secret    GitHub Webhook secret to sign payloads with
 * @param  {Function}       next
 */
exports.register = (server, options, next) => {
    Pipeline = new Models.Pipeline(options.datastore);
    // Register the hook interface
    server.register(githubWebhooks);
    // Add the auth strategy
    server.auth.strategy('githubwebhook', 'githubwebhook', {
        secret: options.secret
    });
    // Now use it
    server.route({
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
                case 'pull_request':
                    return pullRequestEvent(request, reply);
                default:
                    return reply(boom.badRequest(`Event ${eventType} not supported`));
                }
            }
        }
    });
    next();
};

exports.register.attributes = {
    name: 'githubWebhook'
};
