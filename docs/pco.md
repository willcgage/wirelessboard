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
      "strategy": "note_or_brackets",
      "note_category": "Mic / IEM Assignments",
      "team_name_filter": ["Band", "Vocals"],
      "default_group": 1
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
- `mapping.strategy`: Initial implementation will support two conventions:
  1. A person’s plan note in category `Mic / IEM Assignments` equals an ID like `H01`, `BP14` (your Wirelessboard `extended_id`).
  2. If no note exists, parse square brackets from the name, e.g., `"Fatai [H01]"`.
- `mapping.team_name_filter`: Only use assignments from these teams.

## How the mapping works
1. Wirelessboard asks PCO for the selected plan’s team member assignments (limited to `team_name_filter`).
2. For each person:
  - If they have a plan note in category `Mic / IEM Assignments`, use that as `extended_id`.
   - Else, if their display name contains `[ID]`, extract that as `extended_id`.
   - Set `extended_name` to the person’s first/last name.
3. For each `extended_id`, find the corresponding Wirelessboard slot by matching the slot’s existing `extended_id` (recommended) or by the short convention you choose. If a slot already has `extended_id`, it’s updated with the latest `extended_name`. If you’re starting fresh, you can pre‑seed slot `extended_id`s to the IDs you use in PCO (e.g., H01…H08, BP11…BP16).

This keeps the mapping deterministic and easy to reason about.

> The assignment table in the UI expects each slot to expose either a device name (the Shure channel label) or an extended name. If both are blank Wirelessboard highlights those slots with a warning so you can add identifiers in the Config view before mapping people.

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
  "plan_id": "12345678",
  "assignments": 6,
  "updates": 4
}
```

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
- Provide a UI toggle/button in the config/extended names screens to trigger sync.
- Surface sync status in `/data.json` so front‑end can display last sync time.
- Adopt a conflict strategy (e.g., don’t override manual `extended_name` edits unless explicitly allowed).

---

Implementation status: The integration ships with a credential helper (`py/pco_credentials.py`), runtime validation in `py/pco.py`, and a sync endpoint (`/api/pco/sync`). Configure credentials through the UI (or drop them in `config.json` once for migration) and Wirelessboard stores them securely in your operating system keyring.

### Saving credentials in the UI

When you enter your PCO token and secret for the first time, click **Save** to push the credentials into the system keyring. The UI needs to reload the PCO panel so it can fetch the stored metadata and clear the sensitive fields—after saving, close the PCO view (return to the main settings screen) and then reopen it. On the second load you should see a green status message indicating that credentials are stored, and the token/secret inputs will be empty so they are not echoed back in the browser.
