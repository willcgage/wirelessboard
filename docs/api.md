# Extending Wirelessboard
Wirelessboard provides data from receivers in a machine readable JSON format. This data is easily accessible via HTTP and WebSockets.  In addition to the data that Wirelessboard processes, Wirelessboard also supplies raw receiver data.

This data can be found at `http://your_wirelessboard_ip:8058/data.json` (legacy endpoints such as `/micboard.json` remain available for backwards compatibility).

This capability lets you do a few extra things with the data
* Make a 40' high VU meter with LED tape
* Log metrics into a database like [InfluxDB](https://www.influxdata.com/products/influxdb-overview/)

### Example Axient Digital Data

## Logging API

Wirelessboard&nbsp;1.1 introduces a structured logging pipeline that writes JSON records to `logs/application.log`. The same information is available over HTTP so you can stream logs into external tooling, tail them in the browser, or automate retention.

### `GET /api/logs`

Returns the most recent log entries. Supported query parameters:

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `limit` | integer | `200` | Number of matching entries to return (1–1000). |
| `cursor` | string | newest | Zero-based index to continue paging from. Pass the `cursor` from the previous response to fetch older entries. |
| `level` | string | — | Minimum log level to include (`DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`). |
| `source` / `sources` | repeated string | — | Filter to one or more logger namespaces (for example `core`, `web`, `pco`). Provide multiple `source` parameters or a comma separated `sources` value. |
| `search` | string | — | Case-insensitive substring match against the message, logger name, or serialized context. |
| `newer` | boolean | `false` | When `true`, treat `cursor` as the last seen index and return newer entries in chronological order. Useful for live tails. |

Example response:

```json
{
  "ok": true,
  "entries": [
    {
      "ts": "2025-10-06T02:45:33.811Z",
      "level": "INFO",
      "logger": "micboard.web",
      "source": "web",
      "message": "Client connected",
      "context": {"addr": "192.168.0.25"},
      "cursor": "324",
      "index": 324
    }
  ],
  "cursor": "298",
  "has_more": true,
  "sources": ["core", "web", "device", "pco", "discovery"],
  "levels": ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
  "logging": {
    "level": "INFO",
    "console_level": "WARNING",
    "max_bytes": 10485760,
    "backups": 5,
    "levels": {}
  },
  "direction": "desc"
}
```

`entries` are emitted in descending order by default. Supply the returned `cursor` on the next request to fetch older batches until `has_more` becomes `false`. For streaming use cases, pass the last `cursor` along with `newer=true` to receive chronological updates as they are written to disk.

### `POST /api/logs/purge`

Clears the active log file and deletes rotated backups. The handler reads the current retention settings (for example the number of backups to keep) before truncating the file. The response body is a simple `{"ok": true}` on success. Because truncation cannot be undone, the API requires an explicit POST—even from the web UI the button prompts for confirmation.

### `GET /api/logs/settings`

Returns the active logging configuration along with the list of recognised logger sources and level names. The payload mirrors the `logging` block inside `config.json`.

### `POST /api/logs/settings`

Updates the logging configuration at runtime, persists it to `config/config.json`, and immediately reapplies the logging `dictConfig`. Valid keys include `level`, `console_level`, `max_bytes`, `backups`, and an optional `levels` map for per-logger overrides (use short names such as `pco` or full names like `micboard.pco`). Example:

```json
{
  "level": "INFO",
  "console_level": "ERROR",
  "max_bytes": 16777216,
  "backups": 10,
  "levels": {
    "web": "DEBUG",
    "micboard.discovery": "WARNING"
  }
}
```

Requests that fail validation return HTTP&nbsp;400 with an `error` message. On success the handler responds with the normalised configuration so clients can update their UI in place.
```javascript
{
  "ip": "10.9.49.54",
  "raw": {
    "DEVICE_ID": "RF 5-8",
    "ENCRYPTION_MODE": "OFF",
    "FW_VER": "1.1.43.0",
    "MODEL": "AD4Q-A",
    "QUADVERSITY_MODE": "OFF",
    "RF_BAND": "G57",
    "TRANSMISSION_MODE": "STANDARD"
  },
  "status": "CONNECTED",
  "tx": [{
      "antenna": "XX",
      "audio_level": 13,
      "battery": 255,
      "channel": 1,
      "frequency": "594.075",
      "id": "05",
      "name": "",
      "name_raw": "05",
      "quality": 255,
      "raw": {
        "ALL": "255 000 005 033 XX 00 011 00 012",
        "AUDIO_GAIN": "018",
        "AUDIO_LED_BITMAP": "000",
        "AUDIO_LEVEL_PEAK": "005",
        "AUDIO_LEVEL_RMS": "020",
        "AUDIO_MUTE": "OFF",
        "CHAN_NAME": "05",
        "CHAN_QUALITY": "255",
        "ENCRYPTION_STATUS": "OK",
        "FD_MODE": "OFF",
        "FREQUENCY": "0594075",
        "GROUP_CHANNEL": "--,--",
        "INTERFERENCE_STATUS": "NONE",
        "METER_RATE": "00100",
        "RSSI": "2 012",
        "RSSI_LED_BITMAP": "2 00",
        "SLOT_": "",
        "SLOT_BATT_BAR": "",
        "SLOT_BATT_BARS": "8 255",
        "SLOT_BATT_CHARGE_PERCENT": "8 255",
        "SLOT_BATT_CYCLE_COUNT": "8 65535",
        "SLOT_BATT_HEALTH_PERCENT": "8 255",
        "SLOT_BATT_MINS": "8 65535",
        "SLOT_BATT_TYPE": "8 UNKN",
        "SLOT_INPUT_PAD": "8 255",
        "SLOT_OFFSET": "8 255",
        "SLOT_POLARITY": "8 UNKNOWN",
        "SLOT_RF_OUTPUT": "8 UNKNOWN",
        "SLOT_RF_POWER": "8 255",
        "SLOT_RF_POWER_MODE": "8 UNKNOWN",
        "SLOT_SHOWLINK_STATUS": "8 255",
        "SLOT_STATUS": "8 EMPTY",
        "SLOT_TX_DEVICE_ID": "8",
        "SLOT_TX_MODEL": "8 UNKNOWN",
        "TX_BATT_": "",
        "TX_BATT_BARS": "255",
        "TX_BATT_CHARGE_PERCENT": "255",
        "TX_BATT_CYCLE_COUNT": "65535",
        "TX_BATT_HEALTH_PERCENT": "255",
        "TX_BATT_MINS": "65535",
        "TX_BATT_TEMP_C": "255",
        "TX_BATT_TEMP_F": "255",
        "TX_BATT_TYPE": "UNKN",
        "TX_DEVICE_ID": "",
        "TX_INPUT_PAD": "255",
        "TX_LOCK": "UNKNOWN",
        "TX_MODEL": "UNKNOWN",
        "TX_MUTE_MODE_STATUS": "UNKNOWN",
        "TX_OFFSET": "255",
        "TX_POLARITY": "UNKNOWN",
        "TX_POWER_LEVEL": "255",
        "TX_TALK_SWITCH": "UNKNOWN",
        "UNREGISTERED_TX_STATUS": "OK"
      },
      "rf_level": 9,
      "slot": 5,
      "status": "TX_COM_ERROR",
      "tx_offset": -9,
      "type": "axtd"
    },
    {
      "antenna": "XX",
      "audio_level": 13,
      "battery": 255,
      "channel": 2,
      "frequency": "594.975",
      "id": "06",
      "name": "",
      "name_raw": "06",
      "quality": 255,
      "raw": {
        "ALL": "255 000 005 033 XX 00 011 00 012",
        "AUDIO_GAIN": "018",
        "AUDIO_LED_BITMAP": "000",
        "AUDIO_LEVEL_PEAK": "005",
        "AUDIO_LEVEL_RMS": "020",
        "AUDIO_MUTE": "OFF",
        "CHAN_NAME": "06",
        "CHAN_QUALITY": "255",
        "ENCRYPTION_STATUS": "OK",
        "FD_MODE": "OFF",
        "FREQUENCY": "0594975",
        "GROUP_CHANNEL": "--,--",
        "INTERFERENCE_STATUS": "NONE",
        "METER_RATE": "00100",
        "RSSI": "2 013",
        "RSSI_LED_BITMAP": "2 00",
        "SLOT_": "",
        "SLOT_BATT_BAR": "",
        "SLOT_BATT_BARS": "8 255",
        "SLOT_BATT_CHARGE_PERCENT": "8 255",
        "SLOT_BATT_CYCLE_COUNT": "8 65535",
        "SLOT_BATT_HEALTH_PERCENT": "8 255",
        "SLOT_BATT_MINS": "8 65535",
        "SLOT_BATT_TYPE": "8 UNKN",
        "SLOT_INPUT_PAD": "8 255",
        "SLOT_OFFSET": "8 255",
        "SLOT_POLARITY": "8 UNKNOWN",
        "SLOT_RF_OUTPUT": "8 UNKNOWN",
        "SLOT_RF_POWER": "8 255",
        "SLOT_RF_POWER_MODE": "8 UNKNOWN",
        "SLOT_SHOWLINK_STATUS": "8 255",
        "SLOT_STATUS": "8 EMPTY",
        "SLOT_TX_DEVICE_ID": "8",
        "SLOT_TX_MODEL": "8 UNKNOWN",
        "TX_BATT_BARS": "255",
        "TX_BATT_CHARGE_PERCENT": "255",
        "TX_BATT_CYCLE_COUNT": "65535",
        "TX_BATT_HEALTH_PERCENT": "255",
        "TX_BATT_MINS": "65535",
        "TX_BATT_TEMP_C": "255",
        "TX_BATT_TEMP_F": "255",
        "TX_BATT_TYPE": "UNKN",
        "TX_DEVICE_ID": "",
        "TX_INPUT_PAD": "255",
        "TX_LOCK": "UNKNOWN",
        "TX_MODEL": "UNKNOWN",
        "TX_MUTE_MODE_STATUS": "UNKNOWN",
        "TX_OFFSET": "255",
        "TX_POLARITY": "UNKNOWN",
        "TX_POWER_LEVEL": "255",
        "TX_TALK_SWITCH": "UNKNOWN",
        "UNREGISTERED_TX_STATUS": "OK"
      },
      "rf_level": 9,
      "slot": 6,
      "status": "TX_COM_ERROR",
      "tx_offset": -9,
      "type": "axtd"
    },
    {
      "antenna": "XX",
      "audio_level": 13,
      "battery": 255,
      "channel": 3,
      "frequency": "592.800",
      "id": "07",
      "name": "",
      "name_raw": "07",
      "quality": 255,
      "raw": {
        "ALL": "255 000 005 033 XX 00 013 00 012",
        "AUDIO_GAIN": "018",
        "AUDIO_LED_BITMAP": "000",
        "AUDIO_LEVEL_PEAK": "005",
        "AUDIO_LEVEL_RMS": "020",
        "AUDIO_MUTE": "OFF",
        "CHAN_NAME": "07",
        "CHAN_QUALITY": "255",
        "ENCRYPTION_STATUS": "OK",
        "FD_MODE": "OFF",
        "FREQUENCY": "0592800",
        "GROUP_CHANNEL": "--,--",
        "INTERFERENCE_STATUS": "NONE",
        "METER_RATE": "00100",
        "RSSI": "2 012",
        "RSSI_LED_BITMAP": "2 00",
        "SLOT_": "",
        "SLOT_BATT_BAR": "",
        "SLOT_BATT_BARS": "8 255",
        "SLOT_BATT_CHARGE_PERCENT": "8 255",
        "SLOT_BATT_CYCLE_COUNT": "8 65535",
        "SLOT_BATT_HEALTH_PERCENT": "8 255",
        "SLOT_BATT_MINS": "8 65535",
        "SLOT_BATT_TYPE": "8 UNKN",
        "SLOT_INPUT_PAD": "8 255",
        "SLOT_OFFSET": "8 255",
        "SLOT_POLARITY": "8 UNKNOWN",
        "SLOT_RF_OUTPUT": "8 UNKNOWN",
        "SLOT_RF_POWER": "8 255",
        "SLOT_RF_POWER_MODE": "8 UNKNOWN",
        "SLOT_SHOWLINK_STATUS": "8 255",
        "SLOT_STATUS": "8 EMPTY",
        "SLOT_TX_DEVICE_ID": "8",
        "SLOT_TX_MODEL": "8 UNKNOWN",
        "TX_BATT_BARS": "255",
        "TX_BATT_CHARGE_PERCENT": "255",
        "TX_BATT_CYCLE_COUNT": "65535",
        "TX_BATT_HEALTH_PERCENT": "255",
        "TX_BATT_MINS": "65535",
        "TX_BATT_TEMP_C": "255",
        "TX_BATT_TEMP_F": "255",
        "TX_BATT_TYPE": "UNKN",
        "TX_DEVICE_ID": "",
        "TX_INPUT_PAD": "255",
        "TX_LOCK": "UNKNOWN",
        "TX_MODEL": "UNKNOWN",
        "TX_MUTE_MODE_STATUS": "UNKNOWN",
        "TX_OFFSET": "255",
        "TX_POLARITY": "UNKNOWN",
        "TX_POWER_LEVEL": "255",
        "TX_TALK_SWITCH": "UNKNOWN",
        "UNREGISTERED_TX_STATUS": "OK"
      },
      "rf_level": 11,
      "slot": 7,
      "status": "TX_COM_ERROR",
      "tx_offset": -9,
      "type": "axtd"
    },
    {
      "antenna": "XX",
      "audio_level": 0,
      "battery": 255,
      "channel": 4,
      "frequency": "591.150",
      "id": "08",
      "name": "",
      "name_raw": "08",
      "quality": 255,
      "raw": {
        "ALL": "255 000 005 020 XX 00 013 00 013",
        "AUDIO_GAIN": "018",
        "AUDIO_LED_BITMAP": "000",
        "AUDIO_LEVEL_PEAK": "005",
        "AUDIO_LEVEL_RMS": "020",
        "AUDIO_MUTE": "OFF",
        "CHAN_NAME": "08",
        "CHAN_QUALITY": "255",
        "ENCRYPTION_STATUS": "OK",
        "FD_MODE": "OFF",
        "FREQUENCY": "0591150",
        "GROUP_CHANNEL": "--,--",
        "INTERFERENCE_STATUS": "NONE",
        "METER_RATE": "00100",
        "RSSI": "2 013",
        "RSSI_LED_BITMAP": "2 00",
        "SLOT_": "",
        "SLOT_BATT_BAR": "",
        "SLOT_BATT_BARS": "8 255",
        "SLOT_BATT_CHARGE_PERCENT": "8 255",
        "SLOT_BATT_CYCLE_COUNT": "8 65535",
        "SLOT_BATT_HEALTH_PERCENT": "8 255",
        "SLOT_BATT_MINS": "8 65535",
        "SLOT_BATT_TYPE": "8 UNKN",
        "SLOT_INPUT_PAD": "8 255",
        "SLOT_OFFSET": "8 255",
        "SLOT_POLARITY": "8 UNKNOWN",
        "SLOT_RF_OUTPUT": "8 UNKNOWN",
        "SLOT_RF_POWER": "8 255",
        "SLOT_RF_POWER_MODE": "8 UNKNOWN",
        "SLOT_SHOWLINK_STATUS": "8 255",
        "SLOT_STATUS": "8 EMPTY",
        "SLOT_TX_DEVICE_ID": "8",
        "SLOT_TX_MODEL": "8 UNKNOWN",
        "TX_BATT_BARS": "255",
        "TX_BATT_CHARGE_PERCENT": "255",
        "TX_BATT_CYCLE_COUNT": "65535",
        "TX_BATT_HEALTH_PERCENT": "255",
        "TX_BATT_MINS": "65535",
        "TX_BATT_TEMP_C": "255",
        "TX_BATT_TEMP_F": "255",
        "TX_BATT_TYPE": "UNKN",
        "TX_DEVICE_ID": "",
        "TX_INPUT_PAD": "255",
        "TX_LOCK": "UNKNOWN",
        "TX_MODEL": "UNKNOWN",
        "TX_MUTE_MODE_STATUS": "UNKNOWN",
        "TX_OFFSET": "255",
        "TX_POLARITY": "UNKNOWN",
        "TX_POWER_LEVEL": "255",
        "TX_TALK_SWITCH": "UNKNOWN",
        "UNREGISTERED_TX_STATUS": "OK"
      },
      "rf_level": 11,
      "slot": 8,
      "status": "TX_COM_ERROR",
      "tx_offset": 255,
      "type": "axtd"
    }
  ],
  "type": "axtd"
}
```
