# Wirelessboard Multivenue Server

![wirelessboard multivenue](img/multivenue.png)


A single Wirelessboard host can provide separate instances for multiple venues across a campus.

Wirelessboard uses [NGINX](https://www.nginx.com) as a transparent proxy server in multivenue deployments. NGINX internally routes traffic for each venue to the correct Wirelessboard instance based on the URL. For example, `wirelessboard.local/venue-a` renders the instance for venue A while `/venue-b` serves venue B.

## Wirelessboard Configuration
Create and enable a dedicated systemd service for each venue.


`$ cp wirelessboard.service wirelessboard-venue-a.service`

```
[Unit]
Description=Wirelessboard Service
After=network.target

[Service]
# Set the network port for the venue-a instance to 8080
Environment=WIRELESSBOARD_PORT=8080
# Direct Wirelessboard to use a separate configuration path for the venue-a venue
ExecStart=/usr/bin/python3 -u py/wirelessboard.py -f ~/.local/share/wirelessboard/venue-a
WorkingDirectory=/home/wirelessboard/wirelessboard
StandardOutput=inherit
StandardError=inherit
Restart=always
# Run the service as user wirelessboard
User=wirelessboard
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
```

Install the service
```
$ sudo cp wirelessboard-venue-a.service /etc/systemd/system/
$ sudo systemctl start wirelessboard-venue-a.service
$ sudo systemctl enable wirelessboard-venue-a.service
```

> Legacy deployments: copy the generated unit to `/etc/systemd/system/micboard-venue-a.service` if you still rely on the old unit naming convention.

## Configure Landing Page
```
$ cp static/multivenue-template.html static/multivenue.html
```

Add your venues to the page

`static/muitivenue.html`
```
<div class="card-body">
    <p class="card-text"><a href="/venue-a" class="btn btn-secondary btn-block">Venue A</a></p>
    <p class="card-text"><a href="/venue-b" class="btn btn-secondary btn-block">Venue B</a></p>
</div>
```

## Configure NGINX
Install Nginx
```
$ sudo apt update
$ sudo apt install nginx
```

A sample [nginx.conf](nginx-sample.conf) is provided in the `docs` directory.  'upstream' and `location` element must be configured for each venue.


Restart Nginx
```
$ sudo systemctl restart nginx
```

## Setup Background Fileshare
Setup [Samba](fileshare.md) to map to the Wirelessboard `backgrounds` folder. Multiple venues can share or have separate background image repositories.

Wirelessboard defaults to a separate backgrounds folder for each instance. A shared directory can be set via `-b`. For multivenue deployments, set this in the systemd `/etc/systemd/system/wirelessboard-venue.service` file.

```bash
ExecStart=/usr/bin/python3 -u py/wirelessboard.py -f ~/.local/share/wirelessboard/venue-a -b ~/.local/share/wirelessboard/backgrounds
```
