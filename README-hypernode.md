# Running GraphCommerce on Hypernode

## Installing and configuring PM2

Our aim is to have PM2 always running, and automatically restarting and restoring application state after a reboot.

Installing PM2 as global executable:
```sh
npm config set prefix ~/.npm
npm install --quiet -g pm2
echo 'export PATH="$PATH:$HOME/.npm/bin"' >> ~/.bashrc
source ~/.bashrc
# Should show the path to pm2:
which pm2
```

Add pm2 as a service using supervisord. First follow the documentation on enabling
supervisord at https://docs.hypernode.com/hypernode-platform/tools/how-to-use-supervisor.html (you can skip the part about setting up a an actual service with supervisor)

Then create a file at  `~/supervisor/pm2.conf`:
```ini
[program:pm2]
command=/data/web/.npm/bin/pm2 resurrect --no-daemon --log /data/web/logs/pm2
autostart=true
autorestart=true
```

Add and launch the pm2 service:
```sh
supervisorctl reread
supervisorctl add pm2
```
The PM2 daemon should now be running. To check that it works, run `pm2 list`; this should show an
empty process-list, instead of starting a new daemon.

## Setup vhosts + SSL certificates

For each relevant domain name (i.e. the one used to reach the GraphCommerce frontend, and the one used to
reach the Magento backend, in case both are running side-by-side on the same Hypernode), we need to add a
vhost to enable the use of Let's Encrypt SSL certificates. This assumes you are using
[Managed Vhosts](https://docs.hypernode.com/hypernode-platform/nginx/hypernode-managed-vhosts.html)

```sh
hypernode-manage-vhosts gc-frontend.example.com --https --force-https
hypernode-manage-vhosts m2-backend.example.com --https --force-https
```

## Proxy setup

Ensure requests are proxied to the node application for the frontend domains by creating a new file at
`/data/web/nginx/<your_front_end_domain>/server.proxypass.conf`:

```nginx
location  ~* ^\/.* {
    proxy_pass  http://127.0.0.1:3000;

    # Default proxy settings
    proxy_connect_timeout	6000;
    proxy_send_timeout      6000;
    proxy_read_timeout      6000;
    send_timeout            6000;

    proxy_set_header Host $host;
}
```

Repeat the above if your frontend must be reachable by multiple domains. The
`/data/web/nginx/<your_front_end_domain>` directory should already exist as a result of running the
`hypernode-manage-vhosts` command when setting up the vhosts in the previous step.

## Whitelisting the frontend server

If your Magento backend is also running on the Hypernode platform, but not on the same hypernode as the frontend, you
will want to whitelist the frontend Hypernode to avoid it being blocked by the bot protection due to a high number of
requests. (Note: it might be neccesary to do this even if on the same hypernode.)

In either case you can simply whitelist the IP of the hypernode that hosts the frontend by adding the following
file under `~/nginx/http.ratelimit`:

```nginx
geo $limit_conn_per_ip {
    default $remote_addr;
    198.51.100.69 ''; # Replace with relevant IP adress
}
```

Warning: this might make you more susceptible to high server load due to bots. A solution
such as Cloudflare WAF is recommended.

## Whitelisting for external builds / CI

Builds might get ratelimited (especially on the cheaper Hypernode plans) and fail due to the
rate at which calls are made to the `/graphql` endpoint.

To avoid this, it is possible to exclude requests to `/graphql` specifically from IP-based rate
limiting, see https://github.com/ByteInternet/hypernode-docs-next/pull/423 (this PR fixes old
incorrect documentation for whitelisting URLs)

Note: this might also make you more susceptible to DoS by bots, crawlers or malicious actors.
Todo: we should limit this whitelisting rule to GET requests to lower DoS risks
Todo: maybe we can exclude by a custom header instead, and send this header during builds?

## TODOs

- Figure out a more optimal method of serving static resources and data (_next/static, others?),
  requests for which are now passed directly to the nextjs application while they could be served
  directly from disk by nginx/apache
