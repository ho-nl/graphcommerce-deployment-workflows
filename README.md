# GitHub Action workflows for deploying GraphCommerce

This repository contains re-usable GitHub Action workflows for deploying GraphCommerce.

The workflows are split into one for building the application and producing an artifact, and another one for uploading
and activating the artifact on the server.

Currently, there is one pair of workflows for deploying GraphCommerce directly onto a server, where it is then ran in
standalone mode using PM2. Additional platforms/environments may be added in the future.

## Standalone + PM2

In this setup, the GraphCommerce will be running in standalone mode using the PM2 process manager.

### Prerequisites

- Node 14 must be installed
- PM2 must be installed and available as `pm2` in your `PATH`, and should be started across reboots
- Project must have an `ecosystem.config.js` file in the root folder (see https://pm2.keymetrics.io/docs/usage/application-declaration/)
  -  This file tells PM2 how to run your application. See _Usage_ for an example. 
- Project must be built in standalone mode (set `output` to `'standalone'` in `next.config.js`)

### Usage

To use these re-usable workflows to deploy your GraphCommerce project to specific environment (for example _test_),
create a file under `.github/workflows/deploy-test.yml` which invokes the re-usable workflows in this repository. For
example:

```yaml
name: Deploy to Test

on:
  # Automatically deploy on pushes to this branch
  push:
    branches:
      - main
  # Allow manual triggering of workflow
  workflow_dispatch:

# Ensure we don't run multiple deployments for this environment, and cancel running deployments on new pushes
concurrency:
  group: deploy_test 
  cancel-in-progress: true

jobs:
  build-artifact:
    uses: ho-nl/graphcommerce-deployment-workflows/.github/workflows/standalone-build-artifact.yml@main
    # Needed to inherit GitHub secrets (i.e. SSH_KEY; see below)
    secrets: inherit
    with:
      environment: test # Refers to the GitHub environment to inherit secrets from
      frontUrl: 'https://shop.example.com'
      magentoEndpoint: 'https://magento.example.com/graphql'
  activate-artifact:
    uses: ho-nl/graphcommerce-deployment-workflows/.github/workflows/standalone-activate-artifact.yml@main
    needs: build-artifact
    secrets: inherit
    with:
      environment: test
      serverHost: 'server.example.com'
      serverUser: 'user'
      serverPort: 22
```

You must set up an GitHub environment (you can find this under repository settings) for each environment you deploy to,
and add the `SSH_KEY` secret to it, so the  workflows can access the target server using SSH. The `SSH_KEY` secret
should contain the full content of an unencrypted SSH private key file (i.e. `~/.ssh/id_rsa`). The associated public
key must be in the `~/.ssh/authorized_keys` file on the target server. See also https://github.com/appleboy/ssh-action#setting-up-a-ssh-key

An example `ecosystem.config.js` that should work out of the box (you may want to tweak the number of processes):

```js
module.exports = {
    apps: [
        {
            name: "graphcommerce",
            script: "./server.js",
            exec_mode: "cluster",
            instances: 20
        }
    ]
}
```

## TODOs
- Only tested on a single platform so this is still somewhat beta
- Investigate if we can convert this into a custom GitHub action
- Keep old artifacts around and allow rolling back deployments
- Make switching to new artifact safer / atomic
- Some hardcoded things may need to be made configurable
- Replace VERCEL env variables with more self-explanatory and fine-grained variables (requires changes in GraphCommerce)