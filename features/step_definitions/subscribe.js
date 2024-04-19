'use strict';

const { Before, Given, When, Then } = require('@cucumber/cucumber');
const request = require('screwdriver-request');
const Assert = require('chai').assert;
const github = require('../support/github');
const sdapi = require('../support/sdapi');

const TIMEOUT = 240 * 1000;

Before(
  {
    tags: '@subscribe'
  },
  function hook() {
    github.getOctokit();
    this.repoOrg = this.testOrg;
    this.pipelines = {};
    this.pipelineId = null;
    this.builds = null;
    this.commitCreatedTimestamp = null;  
  }
);


Given(
  /^an existing pipeline "([^"]*)" on branch "([^"]*)" (to be subscribed|that subscribes)$/,
  {
    timeout: TIMEOUT
  },
  async function step(repoName, branchName, _) {  
    console.log('branchName: ', branchName);
    console.log('repoName: ', repoName);
    await this.ensurePipelineExists({
      repoName: repoName,
      branch: 'main',
      shouldNotDeletePipeline: true
    });
    this.pipelines[repoName] = {
      pipelineId: this.pipelineId,
      jobs: this.jobs,
      branch: branchName
    }
    console.log(this.pipelines);
  }
);

When(
  /^a new commit is pushed to "([^"]*)" branch of pipeline "([^"]*)"$/,
  {
    timeout: TIMEOUT
  },
  function step(branchName, repoName) {
    return github
      .createBranch(branchName, this.repoOrg, repoName, 'heads/main')
      .then(() => { 
        this.commitCreatedTimestamp = new Date().getTime();
        return github.createFile(branchName, this.repoOrg, repoName);
      })
      .then(({data}) => {
        this.pipelines[repoName] = {
          ...this.pipelines[repoName],
          sha: data.commit.sha
        };
      })
      .catch((err) => {
        console.error('getting into error: ', err);
      });
  }
)

Then(
  /^the "([^"]*)" job is triggered on branch "([^"]*)" of repo "([^"]*)"$/,
  { timeout: TIMEOUT },
  async function step(jobName, _, repoName) {
    const { pipelineId, jobs, sha } = this.pipelines[repoName];

    //createtime should be very close to or even before the upstream pipeline
    const build = await sdapi.searchForBuild({
        instance: this.instance,
        pipelineId,
        desiredSha: sha,
        desiredStatus: ['QUEUED', 'RUNNING', 'SUCCESS', 'FAILURE'],
        jobName,
        jwt: this.jwt
    });

    console.log('build: ', build);
    const job = jobs.find(j => j.name === jobName);

    console.log('this.commitCreatedTimestamp: ', this.commitCreatedTimestamp);
    const buildCreatedTimestamp = new Date(build.createTime).getTime();

    Assert.isAbove(buildCreatedTimestamp, this.commitCreatedTimestamp, 'Timestamp should be greater than commitCreatedTimestamp');

    // this.buildId = build.id;
    // this.pipelines[branchName].eventId = build.eventId;
    // Assert.equal(build.jobId, job.id);
}
);

Then(
  /^the "([^"]*)" job is not triggered on branch "([^"]*)" of repo "([^"]*)"$/,
  { timeout: TIMEOUT },
  async function step(jobName, _, repoName) {
    console.log("job not triggered");
    const { pipelineId, jobs, sha } = this.pipelines[repoName];

    console.log('pipelineId: ', pipelineId);
    console.log('sha: ', sha);

    //createtime should be very close to or even before the upstream pipeline
    const build = await sdapi.searchForBuild({
        instance: this.instance,
        pipelineId,
        // desiredSha: sha,
        desiredStatus: ['QUEUED', 'RUNNING', 'SUCCESS', 'FAILURE'],
        jobName,
        jwt: this.jwt
    });

    console.log('build: ', build);
    const job = jobs.find(j => j.name === jobName);

    const buildCreatedTimestamp = new Date(build.createTime).getTime();
    console.log('this.commitCreatedTimestamp: ', this.commitCreatedTimestamp);

    console.log('buildCreatedTimestamp: ', buildCreatedTimestamp);

    Assert.isBelow(buildCreatedTimestamp, this.commitCreatedTimestamp, 'Timestamp should be smaller than commitCreatedTimestamp');    

    // this.buildId = build.id;
    // this.pipelines[branchName].eventId = build.eventId;
    // Assert.equal(build.jobId, job.id);
}
);