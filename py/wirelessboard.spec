# -*- mode: python -*-

from PyInstaller.utils.hooks import copy_metadata

block_cipher = None

# keyring selects its backend at runtime through entry points declared in its
# distribution metadata, which PyInstaller does not carry into the bundle by
# default. Without this the frozen app falls back to keyring.backends.fail,
# whose set_password() raises — so PCO credentials could never be stored from a
# packaged build, only when running from source.
keyring_metadata = copy_metadata('keyring')

keyring_backends = [
    'keyring.backends.macOS',
    'keyring.backends.Windows',
    'keyring.backends.SecretService',
    'keyring.backends.libsecret',
    'keyring.backends.chainer',
    'keyring.backends.null',
    'keyring.backends.fail',
]


a = Analysis(['wirelessboard.py'],
             binaries=[],
             datas=[('../static/','static/'),
                    ('../democonfig.json','.'),
                    ('../demo.html','.'),
                    ('../dcid.json','.'),
                    ('../package.json','.')] + keyring_metadata,
                      hiddenimports=[
                             'googleapiclient',
                             'googleapiclient.discovery',
                             'googleapiclient.errors',
                             'googleapiclient.http',
                             'google.auth',
                             'google.auth.exceptions',
                             'google.auth.transport.requests',
                             'google.oauth2',
                             'google.oauth2.credentials',
                             'google_auth_oauthlib',
                             'google_auth_oauthlib.flow',
                      ] + keyring_backends,
             hookspath=[],
             runtime_hooks=[],
             excludes=[],
             win_no_prefer_redirects=False,
             win_private_assemblies=False,
             cipher=block_cipher)
pyz = PYZ(a.pure, a.zipped_data,
             cipher=block_cipher)
exe = EXE(pyz,
          a.scripts,
          [],
          exclude_binaries=True,
          name='wirelessboard-service',
          debug=False,
          strip=False,
          upx=True,
          runtime_tmpdir=None,
          console=True )

coll = COLLECT(exe,
               a.binaries,
               a.zipfiles,
               a.datas,
               strip=False,
               upx=True,
               name='wirelessboard-service')
