# Electron Wrapper
Python and JavaScript dependencies can be wrapped with Electron to make deployment a bit easier for those running macOS. This is far from the ideal way to package and deploy an application for the Mac, but it eliminates the need for the command line during the install process. A Cocoa or Swift wrapper should be made eventually—Electron adds ~300 MB to the ~19 MB Wirelessboard executable (the legacy Micboard bundle size is similar).

There are a few different layers.

The frontend is written in JavaScript. [webpack](https://webpack.js.org) packages JS, CSS, and font dependencies into a minified and distributable file.

The Wirelessboard server is written in Python. [PyInstaller](https://pyinstaller.readthedocs.io/en/stable/) packages a Python interpreter, Wirelessboard, and its dependencies into a single executable. (Legacy Micboard builds can still be produced by keeping the old package name.)

The Electron wrapper is written in JavaScript. It provides a menubar app with access to Wirelessboard, its configuration directory, and the Wirelessboard logs. The menu labels continue to include “Micboard” when running in legacy compatibility mode.

## Building the Electron Wrapper
Here are the steps to generate `wirelessboard-server.app`. If you need to ship a legacy build, replace occurrences of `wirelessboard` with `micboard` in the commands below.

Download Wirelessboard and install dependencies.
```shell
wirelessboard@wirelessboard:~$ git clone https://github.com/willcgage/wirelessboard
wirelessboard@wirelessboard:~$ cd wirelessboard/
wirelessboard@wirelessboard:~/wirelessboard$ pip3 install -r py/requirements.txt
wirelessboard@wirelessboard:~/wirelessboard$ pip3 install pyinstaller
wirelessboard@wirelessboard:~/wirelessboard$ npm install
```

Build the frontend JavaScript using webpack.
```shell
wirelessboard@wirelessboard:~/wirelessboard$ npm run build
```

Package the Wirelessboard server application using [PyInstaller](https://pyinstaller.readthedocs.io/en/stable/).
```shell
wirelessboard@wirelessboard:~/wirelessboard$ npm run binary
```

Wrap the PyInstaller-generated executable within an Electron app using Electron Builder.
```shell
wirelessboard@wirelessboard:~/wirelessboard$ npm run pack
```
