### Shure UDP/TCP Protocol
Shure receivers include a protocol for integration with Crestron/AMX control systems. This protocol varies slightly for each receiver. Documentation for the protocol can be found on Shure's website.
* [UHF-R](https://www.shure.com/americas/support/find-an-answer/amx-crestron-control-of-uhf-r-receiver)
* [QLX-D](https://www.shure.com/americas/support/find-an-answer/qlx-d-crestron-amx-control-strings)
* [ULX-D](https://www.shure.com/americas/support/find-an-answer/ulx-d-crestron-amx-control-strings)
* [Axient Digital](https://www.shure.com/americas/support/find-an-answer/axient-digital-crestron-amx-control-strings)
* [SLX-D](https://www.shure.com/en-US/docs/commandstrings/SLXD)
* [SLX-D+](https://www.shure.com/en-US/docs/commandstrings/SLXDplus)
* [PSM 1000](https://pubs.shure.com/guide/PSM1000/en-US)

Every one of these speaks the same ASCII command grammar on TCP port 2202, which is why a single code path drives them all.

Wirelessboard connects to each receiver and enables sampling. With sampling enabled, receivers send data every 100 ms.

Messages from the receiver look like this -
`< SAMPLE 1 ALL XB 035 098 >`
`< REP 1 BATT_BARS 004 >`

⚠️ **The fields inside `SAMPLE` are not the same across models**, which is where "varies slightly" understates things. ULX-D and QLX-D send antenna, RF level and audio level in that order; SLX-D and SLX-D+ send audio peak, audio RMS and RSSI. Reading one with the other's layout produces numbers that look plausible and are wrong. Each model's layout is handled separately in `py/mic.py` and pinned by tests.

Wirelessboard converts data from different types of wireless receivers into a uniform format for the Wirelessboard frontend (legacy Micboard clients continue to function via the compatibility layer).
