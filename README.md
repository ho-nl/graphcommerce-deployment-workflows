# GitHub Action workflows for deploying GraphCommerce

This repository contains re-usable GitHub Action workflows for deploying GraphCommerce.

The workflows are split into one for building the application and producing an artifact, and another one for uploading
and activating the artifact on the server.

Currently, there is one pair of workflows for deploying GraphCommerce directly onto a server, where it is then ran in
standalone mode using PM2. Additional platforms/environments may be added in the future.

## Standalone + PM2

In this setup, the GraphCommerce will be running in standalone mode using the PM2 process manager.

### Prerequisites

- Node 16+ must be installed (or whatever is required for your GraphCommerce version)
- PM2 must be installed and available as `pm2` in your `PATH`, and should be started across reboots
- Project must have an `ecosystem.config.js` file in the root folder (see https://pm2.keymetrics.io/docs/usage/application-declaration/)
  -  This file tells PM2 how to run your application. See _Usage_ for an example. 
- Project must be built in standalone mode (set `output` to `'standalone'` in `next.config.js`), for example:
  - `output: process.env.STANDALONE ? 'standalone' : undefined,` (see https://github.com/ho-nl/project-kommago-gc/blob/0f92050/next.config.js#L40C3-L40C61)

If you are running on Hypernode, refer to [README-hypernode.md](README-hypernode.md) before following the below guide.

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
    inputs:
      limitSsg:
        type: boolean
        description: Limit Static Site Generation
        required: true
        default: false

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
      applicationSuffixId: _main
      environment: test # Refers to the GitHub environment to inherit secrets from
      limitSsg: ${{ inputs.limitSsg == true }}
  activate-artifact:
    uses: ho-nl/graphcommerce-deployment-workflows/.github/workflows/standalone-activate-artifact.yml@main
    needs: build-artifact
    secrets: inherit
    with:
      deployTo: '/data/web/deploy-graphcommerce/'
      applicationSuffixId: _main
      environment: test
      serverHost: 'server.example.com'
      serverUser: 'user'
      serverPort: 22
  activate-pm2:
    uses: ho-nl/graphcommerce-deployment-workflows/.github/workflows/standalone-activate-pm2.yml@main
    needs: activate-artifact
    secrets: inherit
    with:
      # You may want to uncomment the lines below to make your deployments more reliable on certain hosting
      # environments/setups:
      #deleteOldApplications: false
      #scaleApplications: false
      #updatePm2: false
      deployTo: '/data/web/deploy-graphcommerce/'
      applicationSuffixId: _main
      environment: test
      serverHost: 'server.example.com'
      serverUser: 'user'
      serverPort: 22
      # On environments such as hypernode, where we can't set a custom PATH for non-login shells, and need to customize
      # it to be able to run things like PM2. Below is the default value, so npm-installed executables can be invoked.
      # additionalPath: '/data/web/.npm/bin/'
```

You must set up an GitHub environment (called `test` in the above example) for each environment you want to deploy to.
Do this for each environment you deploy to, and add the `SSH_KEY` secret to it so the  workflows can access
the target server using SSH. The `SSH_KEY` secret should contain the full content of an unencrypted SSH private key file
(i.e. `~/.ssh/id_rsa`). The associated public key must be in the `~/.ssh/authorized_keys` file on the target server.
See also https://github.com/appleboy/ssh-action#setting-up-a-ssh-key

GraphCommerce configuration variables (i.e. `GC_MAGENTO_ENDPOINT`) can be overridden by adding them as Github Action
secrets/variables. They will automaticallly be made available during the build job.

An example `ecosystem.config.js` that should work out of the box (you may want to tweak the number of processes):

```js
module.exports = {
    apps: [
        {
            name: "graphcommerce{applicationSuffixId}",
            script: "./graphcommerce{applicationSuffixId}/current/server.js",
            exec_mode: "cluster",
            instances: 20
        }
    ]
}
```
Replace `{applicationSuffixId}` with your applicationSuffixId

You can add a port number optionally:
```
            env: {
                "PORT": 3000
            }
```

### Caveats

- PM2 process management happens by the `apps.name` value given in the `ecosystem.config.js`. If you change this after
  having previously deployed the application, you must manually remove the old application using `pm2 delete
  <old-application-name>`


## TODOs
- Document multiple-application setup
- Allow setting `applicationSuffixId` to empty, and make it the default value, to keep single-application setups elegant
- Investigate if we can convert this into a custom GitHub action
