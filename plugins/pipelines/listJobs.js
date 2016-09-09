'use strict';
const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi.array().items(schema.models.job.get).label('List of jobs');

module.exports = () => ({
    method: 'GET',
    path: '/pipelines/{id}/jobs',
    config: {
        description: 'Get all jobs for a given pipeline',
        notes: 'Returns all jobs for a given pipeline',
        tags: ['api', 'pipelines', 'jobs'],
        handler: (request, reply) => {
            const factory = request.server.app.pipelineFactory;

            return factory.get(request.params.id)
              .then(pipeline => {
                  if (!pipeline) {
                      throw boom.notFound('Pipeline does not exist');
                  }

                  return pipeline.jobs;
              })
              .then(jobs => reply(jobs.map(j => j.toJson())))
              .catch(err => reply(boom.wrap(err)));
        },
        response: {
            schema: listSchema
        }
    }
});
