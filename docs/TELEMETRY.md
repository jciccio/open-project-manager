# Telemetry & Anonymous Diagnostics in Open Project Manager

Open Project Manager includes optional, privacy-respecting, anonymous telemetry to help us understand software usage patterns, version distribution, and active deployments.

We believe in complete transparency and user ownership. This document details exactly what is collected, why, and how you can disable it at any time.

---

## 🔒 Our Privacy Guarantee

- **Zero Personally Identifiable Information (PII)**: We never collect names, email addresses, passwords, IP addresses, or geographic locations.
- **Zero Content Tracking**: We never collect project titles, task descriptions, card comments, tags, labels, or uploaded attachments.
- **Aggregated Numbers Only**: Counters are strictly aggregate numeric values (e.g. `usersCount: 3`, `projectsCount: 5`).
- **Anonymized Instance Identifier**: Every instance generates a random UUID on first start (e.g. `c7b2e10a-4293-41c0-9d04-...`). It contains no hardware identifiers, MAC addresses, or machine serial numbers.
- **Full Transparency**: You can view the exact JSON payload your instance produces at any time via `GET /api/v1/system/telemetry` or in the Profile Modal.
- **Easy Opt-Out**: Telemetry can be disabled completely with a single environment variable or a UI toggle.

---

## 📦 What Data is Collected

The periodic heartbeat payload contains:

| Field | Description | Example |
|---|---|---|
| `instanceId` | Random UUID generated on initial boot | `8e3bb2a0-4fc7-4592-b6ff-183e20dc3e3a` |
| `appVersion` | Current version of Open Project Manager | `0.4.0` |
| `nodeVersion` | Node.js runtime version | `v22.14.0` |
| `platform` | Operating system platform | `linux`, `darwin`, `win32` |
| `arch` | CPU architecture | `x64`, `arm64` |
| `dbProvider` | Configured database engine | `sqlite` or `postgresql` |
| `isDocker` | Whether running inside a container | `true` or `false` |
| `uptimeSeconds` | Process uptime in seconds | `86400` |
| `timestamp` | ISO timestamp of the ping | `2026-09-24T12:00:00.000Z` |
| `metrics.usersCount` | Total registered user accounts | `2` |
| `metrics.projectsCount` | Total projects created | `5` |
| `metrics.cardsCount` | Total cards created | `34` |
| `features.oidcEnabled` | Whether SSO / OIDC is configured | `false` |
| `features.mcpEnabled` | Whether Model Context Protocol is enabled | `true` |
| `features.customPort` | Whether running on non-default port | `false` |

---

## 🚫 How to Opt Out

You can disable telemetry at any time using any of the following methods:

### Option 1: Environment Variable (Recommended for Docker & Production)
Set `OPM_TELEMETRY_DISABLED=1` or `DO_NOT_TRACK=1` in your `.env` or `docker-compose.yml`:

```bash
# In .env
OPM_TELEMETRY_DISABLED=1
```

Or standard Do Not Track:
```bash
DO_NOT_TRACK=1
```

### Option 2: In the Application Settings
1. Open the user menu and click **Profile Settings**.
2. Scroll to the **Anonymous Telemetry** section.
3. Toggle the switch to **Disabled**.

### Option 3: Via REST API
Send an authenticated `PATCH` request:
```bash
curl -X PATCH http://localhost:3000/api/v1/system/telemetry \
  -H "Authorization: Bearer <your-api-token>" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'
```

---

## 🛠️ Custom Telemetry Endpoint

If you run an internal or private telemetry collector (e.g. self-hosted webhook, PostHog, or custom analytics endpoint), you can override the target URL:

```bash
OPM_TELEMETRY_URL=https://my-internal-collector.example.com/api/heartbeat
```
