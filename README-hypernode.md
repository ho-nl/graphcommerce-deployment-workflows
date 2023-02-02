# Running GraphCommerce on Hypernode

## Installing and configuring PM2

Installing PM2 as global executable
```sh
npm config set prefix ~/.npm
npm install --quiet -g pm2
echo 'export PATH="$PATH:$HOME/.npm/bin"' >> ~/.bashrc
source ~/.bashrc
# Should show the path to pm2:
which pm2
```

Add pm2 as a service using supervisord, by creating a file at  `~/supervisor/pm2.conf`:
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
# This should show an (empty) list of processes without launching a new daemon:
pm2 list
```

## Proxy setup

Ensure requests are proxied to the node application by creating a new file at  `/data/web/nginx/<you_node_name>.hypernode.io`:
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

## Notes
- Possible workaround to run PM2 as a forking daemon using supervisord: https://github.com/Supervisor/supervisor/issues/147
    - Running the daemon without forking (using `--no-daemon`) seems to work fine though.