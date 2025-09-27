# Server Installation
Wirelessboard can be installed on many different platforms.  For small and portable systems, Wirelessboard can run on a Raspberry Pi hidden in the back of a rack.

> Upgrading from an existing Micboard deployment?  Wirelessboard remains backward compatible with the old service name, so the legacy commands below will continue to work.  The examples now default to the new repository and binary names.

## Docker (Recommended)
Download and install Docker & Docker Compose

Run docker the docker-compose.yaml file
```
$ mkdir -p ~/docker/wirelessboard
$ cd ~/docker/wirelessboard/
$ curl -O https://raw.githubusercontent.com/willcgage/wirelessboard/main/docker-compose.yaml
$ docker compose up
```


## Debian (Ubuntu & Raspberry Pi)
Install git, python3-pip, and Node.js
```
$ sudo apt-get update
$ sudo apt-get install git python3-pip
$ curl -sL https://deb.nodesource.com/setup_10.x | sudo -E bash -
$ sudo apt-get install nodejs
```

Download Wirelessboard
```
$ git clone https://github.com/willcgage/wirelessboard.git
```

Install Wirelessboard software dependencies via npm and pip
```
$ cd wirelessboard/
$ npm install --only=prod
$ pip3 install -r py/requirements.txt
```

build the Wirelessboard frontend and start the server
```
$ npm run build
$ python3 py/wirelessboard.py
```

Edit `User` and `WorkingDirectory` within `micboard.service` to match your installation and install it as a service (the file name is kept for compatibility).
```
$ sudo cp micboard.service /etc/systemd/system/
$ sudo systemctl start micboard.service
$ sudo systemctl enable micboard.service
```

Check the [configuration](configuration.md) docs for more information on configuring Wirelessboard.

## macOS - Desktop Application
The Mac desktop app has been discontinued.


## macOS - From Source
Install the Xcode command-line tools
```
$ xcode-select --install
```

Install the homebrew package manager
```
$ /usr/bin/ruby -e "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/master/install)"
```

Install python3 and node
```
$ brew install python3 node
```

Download Wirelessboard
```
$ git clone https://github.com/willcgage/wirelessboard.git
```

Install Wirelessboard software dependencies via npm and pip
```
$ cd wirelessboard/
$ npm install --only=prod
$ pip3 install -r py/requirements.txt
```

build the Wirelessboard frontend and run the server
```
$ npm run build
$ python3 py/wirelessboard.py
```

Check the [configuration](configuration.md) docs for more information on configuring Wirelessboard.

Restart Wirelessboard
```
$ python3 py/wirelessboard.py
```