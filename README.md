<p align="center">
  <a href="https://github.com/willcgage/wirelessboard"><img width="90px" height="90px" src="docs/img/logo.png"></a>
</p>

<h1 align="center">Wirelessboard</h1>

A visual monitoring tool for network enabled Shure devices.  Wirelessboard simplifies microphone monitoring and storage for artists, engineers, and volunteers.  View battery, audio, and RF levels from any device on the network.

> Wirelessboard is the new name for the project previously released as **Micboard**.  Existing configurations, environment variables, and automation targeting Micboard continue to work, and migration tips are documented throughout this repo.

![Wirelessboard Storage Photo](docs/img/wccc.jpg)


![wirelessboard diagram](docs/img/slug.png)

## Screenshots
#### Desktop
![Desktop](docs/img/desktop_ui.png)


#### Mobile
<p align="center">
  <img width="33%" src="docs/img/phone_home.png"><img width="33%" src="docs/img/phone_ui.png"><img width="33%" src="docs/img/phone_ui_exp.png">
</p>

#### Mic Storage
![wirelessboard storage](docs/img/tv_imagebg.png)

## Compatible Devices
Wirelessboard supports the following devices -
* Shure UHF-R
* Shure QLX-D<sup>[1](#qlxd)</sup>
* Shure ULX-D
* Shure Axient Digital
* Shure PSM 1000

Wirelessboard uses IP addresses to connect to RF devices.  RF devices can be addressed through static or reserved IPs.  They just need to be consistent.


## Documentation
* [Installation](docs/installation.md)
* [Configuration](docs/configuration.md)
* [Wirelessboard MultiVenue](docs/multivenue.md)

#### Developer Info
* [Building the Electron wrapper for macOS](docs/electron.md)
* [Extending Wirelessboard using the API](docs/api.md)

### Live development workflow

Wirelessboard now ships with a watch-based workflow that keeps the Python server and compiled assets in sync while you work:

1. Install dependencies if you haven't already: `npm install`
2. Start the dev environment with `npm run dev`
  * Webpack runs in watch mode, rebuilding the bundles on every change.
  * `nodemon` restarts the Python server whenever the generated `static/` assets, templates, or files in `py/` change, so a browser refresh shows the latest UI without a manual server restart.

Press `Ctrl+C` to stop both processes. The traditional one-shot build (`npm run build`) and manual server start (`npm run server`) still work for production-style testing.


## Known Issues
<a name="qlxd">1</a>: [QLX-D Firmware](docs/qlxd.md)
