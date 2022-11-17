# Graphcommerce Deployment GitHub Action Workflows

This repository contains re-usable GitHub Action workflows for deploying GraphCommerce.

The workflows for each platform/environment are split into one for building the application into an
artifact, and another one for uploading and activating the artifact on the server.

Currently, there is one pair of workflows for deploying GraphCommerce directly onto a server, where
it is then ran in standalone mode using PM2. Additional platforms/environments may be added in the
future.

## Standalone + PM2

In this setup, the GraphCommerce will be running in standalone mode using the PM2 process manager.

### Prerequisites

- Node 14 must be installed
- PM2 must be installed and available as `pm2` in your `PATH`, and should be started across reboots
- Project must have an `ecosystem.config.js` file in the root folder (see https://pm2.keymetrics.io/docs/usage/application-declaration/)

### Usage

To use these re-usable workflows to deploy your GraphCommerce project to a server, you can call
both from a single workflow, for example:

```yaml
TODO
```

## TODOs
- Only tested on a single platform so this is still very beta
- Some hardcoded things may need to be made configurable (like deployment path)
- Get rid of legacy VERCEL env variables (requires changes in GraphCommerce itself)
- See if we can build a custom action instead of re-usable workflows