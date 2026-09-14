# gc-image-cache-cleanup

Keeps the Next.js image optimizer cache (`.next/cache/images`) below a maximum size by removing the oldest entries.
Meant to run nightly from cron.

## Why a cron script

Before Next.js 16.2 the image cache is never cleaned up, so it grows until the disk is full. Next.js 16.2 added
[`images.maximumDiskCacheSize`](https://nextjs.org/docs/pages/api-reference/components/image#maximumdiskcachesize),
but that implementation doesn't suit large caches served by a PM2 cluster:

- Every process reads all cache files at startup to build its LRU, which is slow and heavy with millions of entries.
- The LRU is kept in memory per process, so cluster workers each track only part of the cache and can't enforce a
  shared limit.

## Installation

Copy [`gc-image-cache-cleanup.mjs`](gc-image-cache-cleanup.mjs) to `$HOME/bin/` on the server. It has no dependencies
and needs Node.js 18.15 or newer.

| Variable                  | Description                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------- |
| `GC_IMAGE_CACHE_MAX_SIZE` | Required. Maximum cache size in binary units, e.g. `500M`, `20G` or `1T`.              |
| `GC_DEPLOY_DIR`           | The `deployTo` directory of your deployment. Defaults to `$HOME/graphcommerce-deploy`. |
| `GC_APPLICATION_NAME`     | The application's directory within `GC_DEPLOY_DIR`. Defaults to `main`.                |

The cache is read from `$GC_DEPLOY_DIR/$GC_APPLICATION_NAME/shared/.next/cache/images`. With the current workflows the
application directory is `graphcommerce` followed by the `applicationSuffixId`, e.g. `graphcommerce_main`.

## Usage

Validate with a dry run first; it logs what would be removed without deleting anything:

```sh
GC_IMAGE_CACHE_MAX_SIZE=20G node $HOME/bin/gc-image-cache-cleanup.mjs --dry-run
```

Example crontab line, running nightly at midnight:

```
0 0 * * * GC_IMAGE_CACHE_MAX_SIZE=20G node $HOME/bin/gc-image-cache-cleanup.mjs > /dev/null 2>&1
```

For multiple applications (e.g. a b2c/b2b split), add a line per application with its own `GC_APPLICATION_NAME` and
`GC_IMAGE_CACHE_MAX_SIZE`.

## Good to know

- Runs append JSON lines to `$GC_DEPLOY_DIR/logs/image-cache-cleanup.log`: `start` (parameters), `finish`
  (statistics), `skipped` (another run is still busy) or `error`. Every line includes the `application`.
- "Oldest" means generated longest ago: cache hits don't touch entries, so there is no last-used time.
- Removing entries while the application runs is safe; a removed image is optimized again on its next request.
- Every run scans the whole cache. For an existing cache with millions of entries the first run can take an hour, so
  do that one manually.
