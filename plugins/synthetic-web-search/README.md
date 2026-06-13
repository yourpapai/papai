# Synthetic Web Search

> Plugin ID: `synthetic-web-search` · Version: 1.0.0 · `defaultEnabled: false`

Web search backed by the [Synthetic Search API](https://api.synthetic.new)
(`POST /v2/search`). Returns result `title`, `url`, and `text` (markdown) so the
agent can answer questions that need up-to-date information not in its training
data.

## Contributions

| Surface         | Name              | Notes                                                             |
| --------------- | ----------------- | ----------------------------------------------------------------- |
| Tool            | `search`          | Query the web; returns ranked title/url/text results              |
| Prompt fragment | `web-search-hint` | Nudges the agent to search for fresh info and `web_fetch` to read |

### `search` tool input

| Field        | Type    | Required | Description                                                               |
| ------------ | ------- | -------- | ------------------------------------------------------------------------- |
| `query`      | string  | Yes      | Search query (≤ 400 chars)                                                |
| `max_length` | integer | No       | Max **total** characters across all results (`0` = no limit, default `0`) |
| `index`      | integer | No       | Return only the result at this 0-based index                              |

When `max_length > 0`, the budget is split evenly across the selected results.
An out-of-range `index` returns `index_out_of_range`.

## Permissions

`http`.

## Allowed hosts

`api.synthetic.new`.

## Configuration

| Key       | Scope | Required | Sensitive | Description       |
| --------- | ----- | -------- | --------- | ----------------- |
| `api_key` | admin | Yes      | Yes       | Synthetic API key |

The key is deployment-wide (admin scope only); there is no per-context override.

## Behavior notes

- **Rate limiting** — checked per chat user (falling back to the storage
  context) before the network call; returns `rate_limited` with
  `retryAfterSec`.
- **Failure handling** — structured tool errors: `not_configured` (missing key
  or unavailable HTTP runtime), `validation_error`, `timeout`, `api_error`
  (carries upstream status), `network_error`.
- Pair with the core `web_fetch` tool to read the full content of a promising
  result.

## Enabling

Approve the plugin in the settings UI admin Plugins area (super admin), set the
admin-scoped `api_key`, then enable it per context.
