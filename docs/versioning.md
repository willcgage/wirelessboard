# Versioning and Release Process

Wirelessboard follows [Semantic Versioning](https://semver.org/) for all published artefacts. This guide walks through the tooling that keeps versions in sync across JavaScript, Python, Git tags, and release bundles.

## Source of truth

The canonical version lives in `package.json`. The `scripts/sync-version.js` helper mirrors that value into `py/version.py` so Python packages and PyInstaller bundles report the same version string.

```text
package.json        -> scripts/sync-version.js -> py/version.py
```

`py/version.py` exports `__version__`, which is imported by build tools such as `py/package_pi.py` when naming artefacts.

## Cutting a new release

1. Choose the bump level (`patch`, `minor`, or `major`) and run `npm version <level>`.
   * npm updates `package.json`, regenerates `py/version.py`, commits the change, and creates a Git tag like `v1.0.1`.
2. Push the commit *and* the tag:

   ```bash
   git push --follow-tags
   ```
3. GitHub Actions detects the `v*` tag and runs `.github/workflows/releases.yml` to build installers and tarballs with the new version embedded in their filenames.
4. Download the workflow artefacts and publish them on the Releases page or other distribution channels.

## Updating dependencies

When Python dependencies change, regenerate the lockfile to capture the exact resolver output:

```bash
npm run pip:lock
```

This reapplies the current virtualenv’s packages to `py/requirements.lock`, keeping releases reproducible.

## Verification checklist

Before pushing a release tag:

- `npm run build` succeeds without unexpected regressions.
- `py/version.py` reports the desired version (auto-generated).
- `py/requirements.lock` is current if Python dependencies changed.
- Changelog includes a summary of user-facing changes.

## Troubleshooting

- **`npm version` fails staging `py/version.py`** – ensure Git is clean and the repository uses the default staging settings. The script runs `git add py/version.py` automatically.
- **CI workflow can’t find the Raspberry Pi tarball** – confirm that `py/package_pi.py` was run after bumping the version so the filename matches `wirelessboard-pi-<version>.tar.gz`.
- **Need a pre-release tag** – `npm version prerelease --preid=beta` creates versions like `1.1.0-beta.0`; push with `--follow-tags` as usual.
