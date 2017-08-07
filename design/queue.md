# Executor Queue

## Context

This is an executor plugin for Screwdriver that makes use of [Resque][node-resque-URL] to add a queueing mechanism.

## Architecture Overview

![](./diagrams/executor-queue-architecture.puml.png)

## Design Decisions

### Router

The `executor-queue` will sit behind `executor-router` until it works as we expect, so as not to disturb people already using `executor-router`.

## Contributing

If you make changes to the architecture, please be sure to update this guide. Further, to update any architecture diagrams, just run `npm run diagrams` (you will need to have [graphviz](http://graphviz.org/) installed locally).

## Resources
* [node-resque][node-resque-URL]
* [resque-bus][resque-bus-URL]

[node-resque-URL]: https://github.com/taskrabbit/node-resque
[resque-bus-URL]: https://github.com/queue-bus/resque-bus
