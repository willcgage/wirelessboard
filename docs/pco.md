# Planning Center Online (PCO) Integration

This document outlines a pragmatic way to integrate Wirelessboard with Planning Center Online (PCO) Services so you can populate Wirelessboard slot names/IDs from your service plans. (Legacy Micboard endpoints continue to work if you have not switched over yet.)

The initial approach focuses on a one‑way sync that updates Wirelessboard’s optional Extended Names (the `extended_id` and `extended_name` stored per slot in `config.json`). This keeps the integration non‑disruptive: your Shure device names still work as today, and PCO can optionally override them when configured.

## Overview
- Goal: Pull people assignments for a plan from PCO Services and map them to Wirelessboard slots by a simple convention, then write `extended_id`/`extended_name` into `config.json`.
- Transport: HTTP calls to PCO REST API.
- Trigger: Manual API call to Wirelessboard (`POST /api/pco/sync`) at first; optional background sync can be added later.

## Requirements
- A PCO Services account with API access.
- Use either:
  - Personal Access Token (PAT): recommended for server‑to‑server use, or
  - OAuth application credentials (Application ID + Secret).

PCO uses HTTP Basic Auth with `token:secret` for PATs. See PCO documentation for creating a PAT.

## Configuration
Add a `pco` section to your Wirelessboard `config.json` (same file that holds groups/slots). Wirelessboard won’t use PCO unless `enabled` is true. The Service Type is optional; Wirelessboard can aggregate plans across all Service Types. The schema is identical to the legacy Micboard integration, so older configs continue to load.

Example (`auth` block is generated automatically once credentials are saved):
```
{
  "port": 8058,
  "pco": {
    "enabled": true,
    "auth": {
      "credential_id": "default",
      "token_digest": "<sha256 digest>",
      "version": 1
    },
    "services": {
      "service_type_id": 123456,
      "plan": {
        "select": "next"
      }
    },
    "mapping": {
      "strategy": "position_or_note",
      "note_category": "Mic / IEM Assignments",
      "team_name_filter": ["Vocal", "Band"],
      "position_number_fallback": false,
      "seed_extended_id": false
    }
  },
  "groups": [ ... ],
  "slots": [ ... ]
}
```

> Tip: When upgrading from earlier releases you can still place `token` / `secret` in the `auth` block. Wirelessboard will migrate them into the system keyring on first use and rewrite `config.json` with the metadata structure above.

Field notes:
- `enabled`: Turn integration on/off without removing config.
- `auth`: Metadata describing keyring-backed credentials. Wirelessboard reads your PAT token/secret from the keyring; `token_digest` proves which token was stored without exposing it.
- `services.service_type_id`: Optional. If omitted, Wirelessboard will find the next upcoming plan across all Service Types.
- `services.plan.select`:
  - `next`: fetches the next upcoming plan for this service type.
  - You can later support explicit `plan_id` or `date`.
- `mapping.strategy`: Which identifier to read a person’s mic from, and in what order.
  - `position_or_note` (default): the PCO **team position name** first, then the note category, then an `[ID]` in the person’s name.
  - `position`: the team position name only.
  - `note_or_brackets`: the pre-1.4 order — note category, then brackets, then position.
- `mapping.team_name_filter`: Only use assignments from these teams. Matched case-insensitively as a substring, so `"Vocal"` also covers a team named `"Vocal Team A"`.

  Prefer the tick boxes in the PCO panel over editing this by hand. The match is a plain substring, so a name that is slightly off — `"Speakers and Hosts"` against a team actually called `"Speakers & Hosts"` — matches nobody and reports nothing; the whole team simply vanishes from the sync. The panel reads the names from the selected plan, so they are always exact. An **empty** list means no filtering at all, which lets camera, production and every other scheduled team compete for microphone slots.
- `mapping.position_number_fallback` (default `false`): Allows a position to match a slot whose label uses a different word but the same number — position `Vocal 1` matching slots labelled `Mic 1` and `IEM 1`.

  **Single-team plans only.** It keys on the trailing number alone, and position names are unique within a team rather than across a plan. With Vocal Team, Band and Speakers and Hosts all scheduled, `Vocal 1`, `Guitar 1` and `Host 1` every one of them reduce to `1` and claim the same `Mic 1` slot — you get a three-way conflict and an arbitrary winner. Leave it off unless exactly one team is ever scheduled.
- `mapping.seed_extended_id` (default `false`): When a slot has no `extended_id` yet, write the position name into it so later syncs match exactly. Off by default so the integration never relabels slots you set up by hand.

## How the mapping works
Planning Center carries the mic name and number on the **team position** a person is
scheduled to. A vocalist under team `Vocal`, position `Vocal 1`, is mic 1 — and
usually IEM 1 as well. Wirelessboard reads that position
(`PlanPerson.attributes.team_position_name`) and resolves it to slots.

1. Wirelessboard fetches the selected plan’s people, dropping anyone whose team is
   excluded by `team_name_filter`.
2. For each person it builds candidate labels in the order set by `mapping.strategy`:
   the team position name, the plan note in `note_category`, and an `[ID]` in the
   person’s display name.
3. Each candidate is matched against the configured slots in three passes, stopping at
   the first pass that hits anything:
   1. **Slot `extended_id` equals the label.** The recommended setup — explicit and
      predictable.
   2. **A Shure channel name equals the label.** Uses whatever is typed into the
      receiver.
   3. **Trailing numbers agree** (only when `position_number_fallback` is on; off by
      default, and safe only on single-team plans). The slot
      label’s prefix has to either match the position’s prefix or be a recognised
      device word (`Mic`, `IEM`, `HH`, `BP`, …), and when it names a device kind the
      slot’s configured type has to agree. So `Vocal 1` finds `Mic 1` on a ULXD slot
      and `IEM 1` on a PSM1000 slot, but never `Band 1`.
4. **Every** slot matched in the winning pass receives the person’s name in
   `extended_name`. This is what lets one position fill both a mic channel and its
   matching IEM channel.

Comparisons ignore case, punctuation, spacing, and leading zeros, so `Vocal 1`,
`vocal-01`, and `VOCAL_1` are the same label.

Device names — live or manually entered — are never touched by a sync. Only
`extended_name` is written (plus `extended_id` if you opt into `seed_extended_id`).

> The assignment table in the UI expects each slot to expose either a device name (the Shure channel label) or an extended name. If both are blank Wirelessboard highlights those slots with a warning so you can add identifiers in the Config view before mapping people.

### Worked example
Slots configured in Wirelessboard:

| slot | type | `extended_id` |
| --- | --- | --- |
| 1 | `ulxd` | `Mic 1` |
| 2 | `ulxd` | `Mic 2` |
| 9 | `p10t` | `IEM 1` |

Plan in Planning Center:

| team | position | person |
| --- | --- | --- |
| Vocal | Vocal 1 | Fatai V |
| Vocal | Vocal 2 | Brooke L |

After a sync, slots 1 and 9 both read `Fatai V` and slot 2 reads `Brooke L`.

### Previewing before you commit
`POST /api/pco/preview` (or the **Preview Sync** button in the PCO view) runs the whole
resolution and returns what *would* change without writing to `config.json`. The
response lists which slots each position matched, which pass matched them, and any
scheduled people that found no slot at all — the fastest way to confirm your slot
labels line up with your position names.

## Listing the teams on a plan
The team chooser is populated from:

```
GET http://<wirelessboard-host>:<port>/api/pco/teams?plan=<plan_id>&service=<service_type_id>
```

```json
{
  "ok": true,
  "plan_id": "89808072",
  "filter_active": true,
  "teams": [
    {"name": "Band", "people": 9, "positions": ["Bass Guitar", "Drums"], "selected": true},
    {"name": "Camera Operators", "people": 7, "positions": ["Camera 1"], "selected": false}
  ]
}
```

`selected` reflects the saved `mapping.team_name_filter`, but the list itself
ignores that filter on purpose — an excluded team still has to appear, or there
would be no way to add it back. `people` counts distinct people, not scheduled
rows, since one person can hold several positions on a team across service
times. `service` is optional and only avoids a redirect.

## Using the sync endpoint
Once configured, trigger a manual sync:

```
POST http://<wirelessboard-host>:<port>/api/pco/sync
Content-Type: application/json
{}
```

Response example:
```
{
  "ok": true,
  "dry_run": false,
  "plan_id": "12345678",
  "strategy": "position_or_note",
  "people": 7,
  "assignments": 6,
  "slots_matched": 11,
  "updates": 4,
  "unmatched": [
    { "name": "Guest Speaker", "team": "Vocal", "position": "Vocal 9", "note": "", "tried": ["Vocal 9"] }
  ],
  "assignment_details": [
    {
      "id": "Vocal 1",
      "name": "Fatai V",
      "team": "Vocal",
      "position": "Vocal 1",
      "note": "",
      "matched_via": "position",
      "slots": [
        { "slot": 1, "type": "ulxd", "extended_id": "Mic 1", "kind": "mic", "via": "number:extended_id" },
        { "slot": 9, "type": "p10t", "extended_id": "IEM 1", "kind": "iem", "via": "number:extended_id" }
      ]
    }
  ]
}
```

`slots_matched` counts slots, `assignments` counts people. Anything in `unmatched`
needs a slot label that lines up, or gets assigned by hand in the Assignments table.

Add `?dry_run=true` to resolve without saving, or call `POST /api/pco/preview`, which
does the same thing.

If config is missing, you’ll get a helpful error payload.

To target a specific plan directly (e.g., one selected in the UI), pass a `plan` query parameter:

```
POST http://<wirelessboard-host>:<port>/api/pco/sync?plan=<PLAN_ID>
```

## Adding background sync (optional)
- You can enable a periodic sync (e.g., every 60 seconds) from Wirelessboard’s Python process. This is off by default to limit new moving parts.
- Start with manual sync, verify mapping results, then enable background sync if desired.

## Next steps and extensions
- Support explicit `plan_id` or date window selection.
- Surface sync status in `/data.json` so front‑end can display last sync time.
- Adopt a conflict strategy (e.g., don’t override manual `extended_name` edits unless explicitly allowed).

## Troubleshooting

**Everything comes back unmatched.** Run **Preview Sync** and read the `tried` list on
each unmatched entry — that is the exact label Wirelessboard looked for. Compare it to
the `extended_id` values in the Config view. If the position is `Vocal 1` and your slots
are unlabelled, label them `Vocal 1` — both the mic channel and the IEM channel, since
every slot in the winning pass is returned. Assign whatever is left by hand.

**The IEM slot never fills in.** Number fallback checks the slot type: a slot labelled
`IEM 1` only counts as an IEM if its `type` is `p10t`. Confirm the PSM1000 is configured
with the right type.

**A person lands on the wrong slot.** Almost always `position_number_fallback` left on
with more than one team scheduled — it keys on the trailing number alone, so every
position ending in `1` competes for `Mic 1`. Turn it off (the default since 1.4.9) and
set explicit `extended_id`s; pass 1 always beats the number fallback.

**Nobody is returned at all.** Check `team_name_filter`. It is a substring match, so
`"Vocal"` matches `"Vocal Team A"`, but `"Vocals"` will not match a team named
`"Vocal"`. An empty list means no filtering.

---

Implementation status: The integration ships with a credential helper (`py/pco_credentials.py`), the matching rules in `py/pco_mapping.py` (covered by `py/tests/`), runtime validation in `py/pco.py`, a sync endpoint (`/api/pco/sync`), and a dry-run endpoint (`/api/pco/preview`). Configure credentials through the UI (or drop them in `config.json` once for migration) and Wirelessboard stores them securely in your operating system keyring.

### Saving credentials in the UI

When you enter your PCO token and secret for the first time, click **Save** to push the credentials into the system keyring. The UI needs to reload the PCO panel so it can fetch the stored metadata and clear the sensitive fields—after saving, close the PCO view (return to the main settings screen) and then reopen it. On the second load you should see a green status message indicating that credentials are stored, and the token/secret inputs will be empty so they are not echoed back in the browser.
