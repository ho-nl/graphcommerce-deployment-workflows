#!/usr/bin/env node
/**
 * Keeps the Next.js image optimizer cache below a maximum size by removing the oldest entries.
 *
 * Before 16.2, Next.js never removes image cache entries by itself. See gc-image-cache-cleanup.md
 * for why this runs from cron rather than using `images.maximumDiskCacheSize`.
 *
 * Every entry is a directory named after the cache key, containing one file:
 * `<maxAge>.<expireAt>.<etag>.<extension>`. Cache hits don't touch that file, so its mtime is the
 * moment the entry was generated: "oldest" means generated longest ago, not least recently used.
 *
 * Usage:
 *   GC_IMAGE_CACHE_MAX_SIZE=20G node ~/bin/gc-image-cache-cleanup.mjs [--dry-run]
 *
 * Environment:
 *   GC_IMAGE_CACHE_MAX_SIZE  Required. Maximum size in binary units, e.g. 500M, 20G or 1T.
 *   GC_DEPLOY_DIR            Defaults to ~/graphcommerce-deploy.
 *
 * The cache is read from $GC_DEPLOY_DIR/graphcommerce_main/shared/.next/cache/images. Runs append
 * JSON lines to $GC_DEPLOY_DIR/logs/image-cache-cleanup.log: a `start` line with the parameters, a
 * `finish` line with statistics, or `skipped` / `error` when a run doesn't start or crashes. Lines
 * of the same run share the `pid`. When the deploy dir itself doesn't exist errors only go to
 * stderr.
 *
 * Sizes are disk usage (allocated blocks of the entry directory and its file). The top-level
 * cache directory itself is not counted, as removing entries doesn't shrink it.
 *
 * Removing entries is safe while the application is running: a missing entry is a cache miss and
 * the image is optimized again on the next request.
 */
import { createHash } from 'node:crypto'
import { appendFileSync, unlinkSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const SCAN_BATCH_SIZE = 256
const DELETE_BATCH_SIZE = 500
const DELETE_PAUSE_MS = 250
const PROGRESS_EVERY = 100_000

const dryRun = process.argv.includes('--dry-run')
const deployDir = process.env.GC_DEPLOY_DIR || path.join(os.homedir(), 'graphcommerce-deploy')
const cacheDirSetting = path.join(deployDir, 'graphcommerce_main/shared/.next/cache/images')
const logFile = path.join(deployDir, 'logs', 'image-cache-cleanup.log')
const maxBytes = parseSize(process.env.GC_IMAGE_CACHE_MAX_SIZE)

function parseSize(value) {
  const match = /^(\d+(?:\.\d+)?)\s*([KMGT]?)(?:i?B)?$/i.exec(value?.trim() ?? '')
  if (!match) return null
  const exponent = ' KMGT'.indexOf(match[2].toUpperCase() || ' ')
  return Math.floor(Number(match[1]) * 1024 ** exponent)
}

function formatBytes(bytes) {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  const exponent = Math.min(Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024)), 4)
  return `${(bytes / 1024 ** exponent).toFixed(exponent ? 1 : 0)} ${units[exponent]}`
}

const seconds = (from, to = Date.now()) => Math.round((to - from) / 100) / 10
const log = (message) => console.log(`[${new Date().toISOString()}] ${message}`)

const logLine = (event, details) =>
  `${JSON.stringify({ event, time: new Date().toISOString(), pid: process.pid, ...details })}\n`

async function appendLog(event, details) {
  // Not recursive: a mistyped GC_DEPLOY_DIR shouldn't create a deploy dir just to hold the log.
  await fs.mkdir(path.dirname(logFile)).catch((error) => {
    if (error.code !== 'EEXIST') throw error
  })
  await fs.appendFile(logFile, logLine(event, details))
}

// Also logs to the log file, as stderr usually goes unread when running from cron.
async function fail(message, event = 'error') {
  const details = {
    dryRun,
    deployDir,
    maxSizeSetting: process.env.GC_IMAGE_CACHE_MAX_SIZE ?? null,
    [event === 'error' ? 'error' : 'reason']: message,
  }
  await appendLog(event, details).catch(() => {})
  console.error(message)
  process.exit(1)
}

process.on('uncaughtException', (error) => {
  try {
    appendFileSync(logFile, logLine('error', { error: error.stack }))
  } catch {}
  console.error(error)
  process.exit(1)
})

if (maxBytes === null) await fail('Set GC_IMAGE_CACHE_MAX_SIZE to a size like 500M, 20G or 1T')

const cacheDir = await fs
  .realpath(cacheDirSetting)
  .catch(() => fail(`Not found: ${cacheDirSetting}`))
if (!cacheDir.endsWith(`${path.sep}${path.join('.next', 'cache', 'images')}`)) {
  await fail(`Refusing to run: ${cacheDir} is not a .next/cache/images directory`)
}

// Only one run per cache directory at a time.
const lockFile = path.join(
  os.tmpdir(),
  `image-cache-cleanup-${createHash('sha1').update(cacheDir).digest('hex').slice(0, 8)}.lock`,
)

function isRunning(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

// Returns the pid of the run holding the lock, or null once this run holds it.
async function acquireLock() {
  try {
    await fs.writeFile(lockFile, String(process.pid), { flag: 'wx' })
    return null
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  const pid = Number(await fs.readFile(lockFile, 'utf8').catch(() => ''))
  if (pid && isRunning(pid)) return pid
  // Left behind by a run that crashed.
  await fs.writeFile(lockFile, String(process.pid))
  return null
}

async function diskFreeBytes() {
  const { bavail, bsize } = await fs.statfs(cacheDir)
  return bavail * bsize
}

const lockHolder = await acquireLock()
if (lockHolder) {
  await fail(`Another cleanup is already running (pid ${lockHolder}) for ${cacheDir}`, 'skipped')
}
process.on('exit', () => {
  try {
    unlinkSync(lockFile)
  } catch {}
})

const startedAt = new Date().toISOString()
const diskFreeBefore = formatBytes(await diskFreeBytes())
await appendLog('start', {
  dryRun,
  maxSize: formatBytes(maxBytes),
  maxBytes,
  deployDir,
  cacheDir,
  logFile,
  lockFile,
  script: fileURLToPath(import.meta.url),
  node: process.version,
  host: os.hostname(),
  user: os.userInfo().username,
  scanBatchSize: SCAN_BATCH_SIZE,
  deleteBatchSize: DELETE_BATCH_SIZE,
  deletePauseMs: DELETE_PAUSE_MS,
  diskFree: diskFreeBefore,
})
log(
  `Started ${dryRun ? 'dry run' : 'cleanup'} (max ${formatBytes(maxBytes)}), logging to ${logFile}`,
)

let aborted = false
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (aborted) process.exit(130)
    log(`Received ${signal}, stopping after the current batch (repeat to exit immediately)`)
    aborted = true
  })
}

const stats = {
  startedAt,
  dryRun,
  cacheDir,
  maxSize: formatBytes(maxBytes),
  maxBytes,
  diskFreeBefore,
  errorCount: 0,
  errors: [],
}

function recordError(error) {
  stats.errorCount++
  if (stats.errors.length < 10) stats.errors.push(`${error.code ?? ''} ${error.message}`.trim())
}

// Scan: collect the name, generation time and disk usage of every entry.
const names = []
const generatedAt = []
const entryBytes = []
const byExtension = {}
let totalBytes = 0
let emptyEntries = 0
let vanishedDuringScan = 0

async function scanEntry(name) {
  const dir = path.join(cacheDir, name)
  try {
    const dirStat = await fs.stat(dir)
    let bytes = dirStat.blocks * 512
    let mtimeMs = dirStat.mtimeMs
    const files = await fs.readdir(dir)
    if (files.length === 0) emptyEntries++
    for (const file of files) {
      const fileStat = await fs.stat(path.join(dir, file))
      bytes += fileStat.blocks * 512
      mtimeMs = fileStat.mtimeMs
      const extension = path.extname(file).slice(1) || 'none'
      byExtension[extension] ??= { entries: 0, bytes: 0 }
      byExtension[extension].entries++
      byExtension[extension].bytes += fileStat.blocks * 512
    }
    names.push(name)
    generatedAt.push(mtimeMs)
    entryBytes.push(bytes)
    totalBytes += bytes
  } catch (error) {
    if (error.code === 'ENOENT') vanishedDuringScan++
    else recordError(error)
  }
}

const scanStartedAt = Date.now()
log(`Scanning ${cacheDir}${dryRun ? ' (dry run)' : ''}`)

let scanBatch = []
for await (const dirent of await fs.opendir(cacheDir, { bufferSize: SCAN_BATCH_SIZE })) {
  if (aborted) break
  if (!dirent.isDirectory()) continue
  scanBatch.push(dirent.name)
  if (scanBatch.length < SCAN_BATCH_SIZE) continue
  await Promise.all(scanBatch.map(scanEntry))
  scanBatch = []
  if (names.length % PROGRESS_EVERY < SCAN_BATCH_SIZE) {
    log(`Scanned ${names.length} entries (${formatBytes(totalBytes)})`)
  }
}
if (!aborted) await Promise.all(scanBatch.map(scanEntry))

stats.scanSeconds = seconds(scanStartedAt)
stats.before = {
  entries: names.length,
  size: formatBytes(totalBytes),
  bytes: totalBytes,
  emptyEntries,
  vanishedDuringScan,
  byExtension: Object.fromEntries(
    Object.entries(byExtension).map(([extension, { entries, bytes }]) => [
      extension,
      { entries, size: formatBytes(bytes), bytes },
    ]),
  ),
}
log(`Scanned ${names.length} entries (${formatBytes(totalBytes)}) in ${stats.scanSeconds}s`)

// Remove the oldest entries until the cache fits.
const order = names.map((_, index) => index).sort((a, b) => generatedAt[a] - generatedAt[b])
const describe = (index) =>
  index === undefined
    ? null
    : { name: names[index], generatedAt: new Date(generatedAt[index]).toISOString() }

stats.oldestEntry = describe(order[0])
stats.newestEntry = describe(order[order.length - 1])

const removed = { entries: 0, bytes: 0, oldest: null, newest: null }
let skippedRewritten = 0
let vanishedDuringDelete = 0
let currentBytes = totalBytes
let position = 0

async function removeEntry(index) {
  if (dryRun) return 'removed'
  const dir = path.join(cacheDir, names[index])
  try {
    // Next.js recreates the directory whenever it (re)generates an entry, so a newer mtime means
    // the entry was written after the scan started.
    if ((await fs.stat(dir)).mtimeMs > scanStartedAt) return 'rewritten'
    await fs.rm(dir, { recursive: true, force: true })
    return 'removed'
  } catch (error) {
    if (error.code === 'ENOENT') return 'vanished'
    recordError(error)
    return 'error'
  }
}

const deleteStartedAt = Date.now()
if (!aborted && currentBytes > maxBytes) {
  const action = dryRun ? 'planning removal of' : 'removing'
  log(`Over the limit by ${formatBytes(currentBytes - maxBytes)}, ${action} the oldest entries`)
}

while (!aborted && currentBytes > maxBytes && position < order.length) {
  const deleteBatch = []
  let projectedBytes = currentBytes
  while (
    deleteBatch.length < DELETE_BATCH_SIZE &&
    projectedBytes > maxBytes &&
    position < order.length
  ) {
    const index = order[position++]
    deleteBatch.push(index)
    projectedBytes -= entryBytes[index]
  }

  const results = await Promise.all(deleteBatch.map(removeEntry))
  results.forEach((result, i) => {
    const index = deleteBatch[i]
    if (result === 'rewritten') skippedRewritten++
    if (result === 'vanished') vanishedDuringDelete++
    if (result !== 'removed' && result !== 'vanished') return
    currentBytes -= entryBytes[index]
    if (result !== 'removed') return
    removed.entries++
    removed.bytes += entryBytes[index]
    removed.oldest ??= describe(index)
    removed.newest = describe(index)
  })

  if (dryRun) continue
  if (removed.entries % PROGRESS_EVERY < DELETE_BATCH_SIZE) {
    log(`Removed ${removed.entries} entries (${formatBytes(removed.bytes)})`)
  }
  await sleep(DELETE_PAUSE_MS)
}

stats.deleteSeconds = seconds(deleteStartedAt)
stats[dryRun ? 'wouldRemove' : 'removed'] = {
  entries: removed.entries,
  size: formatBytes(removed.bytes),
  bytes: removed.bytes,
  oldest: removed.oldest,
  newest: removed.newest,
  skippedRewritten,
  vanished: vanishedDuringDelete,
}
stats.oldestKeptEntry = describe(order[position])
stats.after = {
  entries: names.length - removed.entries - vanishedDuringDelete,
  size: formatBytes(currentBytes),
  bytes: currentBytes,
}
stats.diskFreeAfter = formatBytes(await diskFreeBytes())
stats.aborted = aborted
stats.finishedAt = new Date().toISOString()
stats.durationSeconds = seconds(Date.parse(stats.startedAt))

await appendLog('finish', stats)
console.log(JSON.stringify(stats, null, 2))
log(`Statistics appended to ${logFile}`)
