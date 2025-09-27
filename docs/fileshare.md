# File Sharing via Samba
<p align="center">
  <img width="50%" src="img/smb.png"><img width="50%" src="img/smb_folder.png">
</p>

Wirelessboard's configuration directory can be shared via [Samba](https://www.samba.org). This makes it easy to remotely add backgrounds, edit Wirelessboard configurations, and view logs. Legacy Micboard installs can use the same approach—simply substitute the older directory names shown in parentheses below.

Slots now render their artwork with dedicated HTML5 `<img>` and `<video>` elements, so any JPEG background or muted, looping MP4 that modern browsers can decode will play automatically once it lands in the shared `backgrounds/` folder. See the [configuration guide](configuration.md#background-images) for details on how filenames are matched to channel names and the recommended codecs.

### MacOS
![mac fileshare](img/smb_server_mac.png)
On MacOS, open up the Sharing pane within System Preferences

Enable File Sharing

Add the Wirelessboard config folder (`~/Library/Application Support/wirelessboard/`; legacy: `.../micboard/`).

### Debian Servers (Ubuntu & Raspberian)
Install Samba

```
$ sudo apt-get update
$ sudo apt-get install samba
```

Add a share for Wirelessboard in /etc/samba/smb.conf (rename to `micboard` if you are still running the legacy service).

```
[wirelessboard]
    comment = Wirelessboard
    path = /home/wirelessboard/.local/share/wirelessboard
    read only = no
    browsable = yes
```

Add a user for the share
```
$ sudo smbpasswd -a wirelessboard
```

restart samba and enable it at startup

```
$ sudo systemctl restart smbd
$ sudo systemctl enable smbd
```
