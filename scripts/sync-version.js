#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PACKAGE_JSON_PATH = path.join(PROJECT_ROOT, 'package.json');
const PY_VERSION_PATH = path.join(PROJECT_ROOT, 'py', 'version.py');
const RELATIVE_PY_VERSION_PATH = path.relative(PROJECT_ROOT, PY_VERSION_PATH);
const WEBPACK_CONFIG_PATH = path.join(PROJECT_ROOT, 'webpack.config.js');

function getPackageVersion() {
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
  if (!packageJson.version) {
    throw new Error('package.json is missing a "version" field.');
  }
  return packageJson.version;
}

function writePythonVersion(version) {
  const header = '"""Wirelessboard version information.\n\n' +
    'This file is generated from package.json. Do not edit manually; run\n' +
    '`npm version` with the appropriate semver bump to refresh it.\n' +
    '"""\n\n__all__ = ("__version__",)\n\n';
  const body = `__version__ = "${version}"\n`;
  fs.writeFileSync(PY_VERSION_PATH, header + body, 'utf8');
}

function stage(relativePaths, description) {
  const result = spawnSync('git', ['add', ...relativePaths], {
    stdio: 'inherit',
    cwd: PROJECT_ROOT,
  });
  if (result.status !== 0) {
    throw new Error(`Failed to stage ${description}.`);
  }
}

// webpack bakes the version into the bundles through DefinePlugin, so they are
// as much a generated artifact of package.json as py/version.py is. 1.10.0
// shipped with bundles still reporting 1.9.1 because the bump regenerated one
// and not the other; rebuilding here is what stops that recurring.
function rebuildBundles(npmCli) {
  const result = spawnSync(process.execPath, [npmCli, 'run', 'build'], {
    stdio: 'inherit',
    cwd: PROJECT_ROOT,
  });
  if (result.status !== 0) {
    throw new Error('Failed to rebuild the frontend bundles (`npm run build`).');
  }
}

// Read the entry points off the webpack config rather than listing them here.
// A hardcoded list that quietly falls behind a new entry would reintroduce the
// exact staleness this build exists to prevent.
function bundleOutputPaths() {
  const { entry, output } = require(WEBPACK_CONFIG_PATH);
  return Object.keys(entry).flatMap((name) => {
    const bundle = path.join(output.path, output.filename.replace('[name]', name));
    // devtool is 'source-map', so every bundle has a sibling map. webpack also
    // writes a LICENSE.txt next to any bundle carrying a preserved banner --
    // only some entries have one, hence the existence filter. Its content does
    // not move with the version, but the rebuild rewrites it with LF endings,
    // and staging it is what stops `npm version` leaving a tree that reads as
    // modified over nothing but core.autocrlf.
    return [bundle, `${bundle}.map`, `${bundle}.LICENSE.txt`];
  })
    .filter(file => fs.existsSync(file))
    .map(file => path.relative(PROJECT_ROOT, file));
}

// npm points npm_execpath at its own CLI while running a lifecycle script, so
// running that under the current node reaches `npm run build` with no dependence
// on a shim being resolvable on PATH -- which matters on Windows, where node
// refuses to spawn npm.cmd without a shell, and `shell: true` concatenates
// arguments rather than escaping them (Node DEP0190). Checked up front so an
// invocation that cannot finish does not leave py/version.py rewritten first.
function resolveNpmCli() {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    throw new Error(
      'sync-version.js expects to run as an npm lifecycle script (npm_execpath is unset).\n'
      + 'Run `npm version <bump>`, or `npm run build` by hand if you only want the bundles.',
    );
  }
  return npmCli;
}

try {
  const npmCli = resolveNpmCli();
  const version = getPackageVersion();
  writePythonVersion(version);
  stage([RELATIVE_PY_VERSION_PATH], 'py/version.py');
  rebuildBundles(npmCli);
  const bundles = bundleOutputPaths();
  stage(bundles, 'the rebuilt frontend bundles');
  console.log(`Synchronized py/version.py and ${bundles.length} bundle files to ${version}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
