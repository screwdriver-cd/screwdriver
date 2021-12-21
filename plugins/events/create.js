'use strict';

const boom = require('@hapi/boom');
const urlLib = require('url');
const validationSchema = require('screwdriver-data-schema');
const ANNOT_RESTRICT_PR = 'screwdriver.cd/restrictPR';
const { getScmUri } = require('../helper');

module.exports = () => ({
    method: 'POST',
    path: '/events',
    options: {
        description: 'Create and start a event',
        notes: 'Create and start a specific event',
        tags: ['api', 'events'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest', 'pipeline']
        },

        handler: async (request, h) => {
            const { buildFactory, jobFactory, eventFactory, pipelineFactory, userFactory } = request.server.app;
            const { buildId, causeMessage, creator } = request.payload;
            const { scmContext, username } = request.auth.credentials;
            const { scm } = eventFactory;
            const { isValidToken } = request.server.plugins.pipelines;
            const { updateAdmins } = request.server.plugins.events;

            let {
                pipelineId,
                startFrom,
                parentBuildId,
                parentBuilds,
                groupEventId,
                parentEventId,
                prNum
            } = request.payload;

            // restart case
            if (buildId) {
                const b = await buildFactory.get(buildId);
                const j = await jobFactory.get(b.jobId);

                ({ pipelineId, name: startFrom } = j);
                ({ parentBuildId, eventId: parentEventId } = b);

                if (b.parentBuilds) {
                    parentBuilds = b.parentBuilds;
                }

                if (b.eventId && !groupEventId) {
                    const parentEvent = await eventFactory.get(b.eventId);

                    groupEventId = parentEvent.groupEventId || b.eventId;
                }
            }

            const payload = {
                pipelineId,
                scmContext,
                startFrom,
                type: 'pipeline',
                username,
                meta: request.payload.meta // always exists because default is {}
            };

            if (parentEventId) {
                payload.parentEventId = parentEventId;
            }

            if (parentBuildId) {
                payload.parentBuildId = parentBuildId;
            }

            if (groupEventId) {
                payload.groupEventId = groupEventId;
            }

            if (parentBuilds) {
                payload.parentBuilds = parentBuilds;
            }

            if (causeMessage) {
                payload.causeMessage = causeMessage;
            }

            if (creator) {
                payload.creator = creator;
            }

            // Check for startFrom
            if (!startFrom) {
                throw boom.badRequest('Missing "startFrom" field');
            }

            // Trigger "~pr" needs to have PR number given
            // Note: To kick start builds for all jobs under a PR,
            // you need both the prNum and the trigger "~pr" as startFrom
            if (startFrom.match(validationSchema.config.regex.PR_TRIGGER) && !prNum) {
                throw boom.badRequest('Trigger "~pr" must be accompanied by a PR number');
            }

            if (!prNum) {
                // If PR number isn't given, induce it from "startFrom"
                // Match PR-prNum, then extract prNum
                // e.g. if startFrom is "PR-1:main", prNumFullName will be "PR-1"; prNum will be "1"
                const prNumFullName = startFrom.match(validationSchema.config.regex.PR_JOB_NAME);

                prNum = prNumFullName ? prNumFullName[1].split('-')[1] : null;
            }

            // Fetch the pipeline and user models
            const [pipeline, user] = await Promise.all([
                pipelineFactory.get(pipelineId),
                userFactory.get({ username, scmContext })
            ]);

            payload.scmContext = pipeline.scmContext;

            // In pipeline scope, check if the token is allowed to the pipeline
            if (!isValidToken(pipeline.id, request.auth.credentials)) {
                throw boom.unauthorized('Token does not have permission to this pipeline');
            }

            // Use parent's scmUri if pipeline is child pipeline and using read-only SCM
            const scmUri = await getScmUri({ pipeline, pipelineFactory });

            // Check the user's permission
            const permissions = await user.getPermissions(scmUri);

            // Update admins
            if (!prNum) {
                await updateAdmins({ permissions, pipeline, username });
            }

            // Get scmConfig
            const token = await user.unsealToken();
            const scmConfig = {
                prNum,
                scmContext: pipeline.scmContext,
                scmUri: pipeline.scmUri,
                token
            };

            // Get and set PR data; update admins
            if (prNum) {
                payload.prNum = String(prNum);
                payload.type = 'pr';

                const [files, prInfo] = await Promise.all([
                    scm.getChangedFiles({
                        webhookConfig: null,
                        type: 'pr',
                        ...scmConfig
                    }),
                    scm.getPrInfo(scmConfig)
                ]);

                if (files && files.length) {
                    payload.changedFiles = files;
                }

                payload.prInfo = prInfo;
                payload.prRef = prInfo.ref;
                payload.prSource = prInfo.prSource;
                payload.chainPR = pipeline.chainPR;
                let restrictPR = 'none';

                if (pipeline.annotations && pipeline.annotations[ANNOT_RESTRICT_PR]) {
                    restrictPR = pipeline.annotations[ANNOT_RESTRICT_PR];
                }

                // PR author should be able to rerun their own PR build if restrictPR is not on
                if (restrictPR !== 'none' || prInfo.username !== username) {
                    // Remove user from admins
                    await updateAdmins({
                        permissions,
                        pipeline,
                        username
                    });
                }
            }

            let sha;

            try {
                // User has good permissions, create an event
                sha = await scm.getCommitSha(scmConfig);
            } catch (err) {
                if (err.status) {
                    throw boom.boomify(err, { statusCode: err.status });
                }
            }

            payload.sha = sha;

            // If there is parentEvent, pass workflowGraph and sha to payload
            // Skip PR, for PR builds, we should always start from latest commit
            if (payload.parentEventId) {
                const parentEvent = await eventFactory.get(parentEventId);

                payload.baseBranch = parentEvent.baseBranch || null;

                if (!payload.meta.parameters && parentEvent.meta && parentEvent.meta.parameters) {
                    payload.meta.parameters = parentEvent.meta.parameters;
                }

                if (!prNum) {
                    payload.workflowGraph = parentEvent.workflowGraph;
                    payload.sha = parentEvent.sha;

                    if (parentEvent.configPipelineSha) {
                        payload.configPipelineSha = parentEvent.configPipelineSha;
                    }
                }
            }

            const event = await eventFactory.create(payload);

            if (event.builds === null) {
                return boom.notFound('No jobs to start.');
            }
            // everything succeeded, inform the user
            const location = urlLib.format({
                host: request.headers.host,
                port: request.headers.port,
                protocol: request.server.info.protocol,
                pathname: `${request.path}/${event.id}`
            });

            return h
                .response(event.toJson())
                .header('Location', location)
                .code(201);
        },
        validate: {
            payload: validationSchema.models.event.create
        }
    }
});
