# Git LFS Setup for Wirelessboard

This document describes the Git Large File Storage (LFS) configuration for the Wirelessboard repository.

## Overview

Wirelessboard uses Git LFS to efficiently handle large files including:
- Documentation images (PNG, JPG, JPEG files in `docs/img/`)
- Build artifacts (ZIP, TAR.GZ files)
- Binary executables and installers
- Media files (MP4, MOV, AVI, GIF)
- App bundles and installers

## For Developers

### Initial Setup

1. **Install Git LFS** if you haven't already:
   ```bash
   # Ubuntu/Debian
   sudo apt-get install git-lfs
   
   # macOS
   brew install git-lfs
   
   # Windows - download from https://git-lfs.com/
   ```

2. **Initialize LFS in your local repository**:
   ```bash
   git lfs install
   ```

3. **Pull existing LFS files**:
   ```bash
   git lfs pull
   ```

### Working with LFS Files

- **Tracked file types** are automatically handled by LFS based on `.gitattributes`
- **Check LFS status**: `git lfs status`
- **List tracked patterns**: `git lfs track`
- **View LFS objects**: `git lfs ls-files`

### Adding New Large Files

New files matching the patterns in `.gitattributes` are automatically tracked by LFS. For manual tracking:

```bash
# Track a specific file
git lfs track "path/to/largefile.zip"

# Track all files of a type
git lfs track "*.pdf"
```

After tracking, commit the changes to `.gitattributes` and your files normally:
```bash
git add .gitattributes
git add your-large-file.zip
git commit -m "Add large file with LFS tracking"
```

## For CI/CD

The GitHub Actions workflows have been updated to include LFS support:
- All `actions/checkout@v4` steps now include `lfs: true`
- This ensures build artifacts and documentation images are available during CI

## File Patterns

The following patterns are tracked by LFS (see `.gitattributes`):

- `docs/img/*.png`, `docs/img/*.jpg`, `docs/img/*.jpeg` - Documentation images
- `*.zip`, `*.tar.gz` - Archives and build artifacts  
- `*.exe`, `*.dmg`, `*.app` - Binary executables and installers
- `dist/`, `build/` - Build output directories
- `*.mp4`, `*.mov`, `*.avi`, `*.gif` - Media files
- `static/splash/*.png` - App splash screens
- `node_modules/**/*.node` - Native Node.js modules

## Troubleshooting

### Large Repository Clone Times
If cloning takes a long time, you can clone without LFS files initially:
```bash
GIT_LFS_SKIP_SMUDGE=1 git clone https://github.com/willcgage/wirelessboard.git
cd wirelessboard
git lfs pull
```

### Missing LFS Files
If you see pointer files instead of actual content:
```bash
git lfs pull
```

### Storage Quota Issues
If you hit LFS storage limits, consider:
- Using `.gitignore` for temporary build artifacts
- Cleaning up old, unnecessary large files from git history
- Considering alternative storage for very large assets

## Docker and Release Users

**Note**: If you're using Docker or downloading pre-built releases, Git LFS is not required. LFS is only needed for development workflows that involve cloning the repository.