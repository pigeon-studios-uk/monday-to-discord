<div align="center">
  <h1>Monday to Discord</h1>

  <p><strong>Posts monday.com board activity to Discord: items moved between groups, status changes, new items and new updates, routed by rules.</strong></p>

  <p>
    <a href="https://github.com/pigeon-studios-uk/monday-to-discord/releases/latest"><img src="https://img.shields.io/github/v/release/pigeon-studios-uk/monday-to-discord?label=release&color=2ea043" alt="Latest release" /></a>
    <a href="LICENSE.md"><img src="https://img.shields.io/badge/licence-Pigeon%20Studios%20Free-6f42c1" alt="Licence: Pigeon Studios Free Licence" /></a>
    <img src="https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white" alt="Node.js 20 or newer" />
    <img src="https://img.shields.io/badge/dependencies-none-2ea043" alt="No dependencies" />
  </p>

  <p>
    <a href="#getting-started"><strong>Get started</strong></a> ·
    <a href="#rules">Rules</a> ·
    <a href="#deploying">Deploy</a> ·
    <a href="CHANGELOG.md">Changelog</a> ·
    <a href="https://discord.gg/2NFVWEUmDF">Support</a>
  </p>
</div>

---

## Contents

- [Overview](#overview)
- [Features](#features)
- [What it posts](#what-it-posts)
- [Requirements](#requirements)
- [Getting started](#getting-started)
- [Connecting monday.com](#connecting-mondaycom)
- [Rules](#rules)
- [Settings](#settings)
- [Commands](#commands)
- [Deploying](#deploying)
- [Updating](#updating)
- [How it works](#how-it-works)
- [Security and privacy](#security-and-privacy)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Support](#support)
- [Contributing](#contributing)
- [Licence](#licence)
- [Credits](#credits)

## Overview

Monday to Discord is a free, small web service by [Pigeon Studios](https://pigeonstudios.co.uk) that listens for monday.com webhooks and posts tidy messages to Discord channels. Tell it what matters to you, such as "anything moved into *Ready for deployment* on the *Development* board goes to #deployments and pings @Developers", and your team sees it in Discord without anyone copying things across.

It has no dependencies, starts in a moment, and runs anywhere Node.js does: Render, a VPS, Docker or your own computer.

## Features

- **Four kinds of activity:** an item moved to another group, a status column changed, a new item, and a new update (comment).
- **Rules for routing.** Each rule picks events by board, group, status and column, and sends them to its own Discord webhook with its own title, colour, name and role ping.
- **Real names.** With a monday.com API token, messages show board names, group names, who made the change, the update text and a link to the item, instead of IDs.
- **Safe messages.** Nothing from monday.com can ping anyone or break formatting. Only the role you choose is ever pinged.
- **Protected webhook address.** Requests without your secret are rejected, so nobody else can post through it.
- **No duplicates.** monday.com's retries are recognised and ignored, and an event matching two rules for the same channel is posted once.
- **Reliable delivery.** It answers monday.com straight away, then sends to Discord with retries, respecting Discord's rate limits.
- **Clear setup errors.** Every mistake in your settings or rules is explained when it starts, and `check` tests them without starting anything.
- **Test messages.** `test` posts a sample message for every rule, so you can see how they look.
- **No dependencies.** Just Node.js 20 or newer.

## What it posts

An item moving into a group, with the board, where it came from, who moved it and when:

> **Release 2.0 moved to Ready for deployment** *(links to the item)*
> **Board** Development · **From** In progress · **To** Ready for deployment · **By** Sam Smith · **When** 18 October 2026 10:00

A status change: **Fix login: Done**, with **Status** Working on it → **Done**.

A new update, quoting what was written:

> **New update on Release 2.0**
> > Looks good, ship it.

Titles, descriptions, colours, webhook names and pings are all set per rule.

## Requirements

| Requirement | Notes |
|---|---|
| Node.js 20 or newer | Or Docker |
| A public HTTPS address | monday.com has to be able to reach it. Render gives you one; on a VPS use a reverse proxy |
| A Discord webhook for each channel | **Channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL** |
| A monday.com API token | Recommended, for names instead of IDs: your avatar → **Developers** → **My access tokens** |

## Getting started

1. **Download** the latest release from [Releases](https://github.com/pigeon-studios-uk/monday-to-discord/releases/latest) and extract it, or clone the repository.
2. **Create your settings:** copy `.env.example` to `.env` and fill it in. At minimum, set `RELAY_SECRET` to a long random value:

   ```bash
   node -e "console.log(crypto.randomBytes(24).toString('base64url'))"
   ```

3. **Create your rules:** copy `config.example.json` to `config.json` and edit it (see [Rules](#rules)).
4. **Check everything:**

   ```bash
   npm run check
   ```

5. **Send test messages** to see how each rule looks in Discord:

   ```bash
   npm run test-message
   ```

6. **Start it:**

   ```bash
   npm start
   ```

7. **Connect monday.com** (next section).

There's nothing to install: `npm start` just runs `node src/index.js`.

## Connecting monday.com

Your webhook address is:

```text
https://<your-host>/monday/<RELAY_SECRET>
```

On each board you want to watch:

1. Open the board, then **Integrate** (top right) → search for **Webhooks**.
2. Choose a recipe for each kind of event you want:
   - **When an item is moved to any group, send a webhook** (for `item_moved`)
   - **When a column changes, send a webhook**, choosing your status column (for `status_changed`)
   - **When an item is created, send a webhook** (for `item_created`)
   - **When an update is created, send a webhook** (for `update_posted`)
3. Paste your webhook address and save. monday.com checks the address straight away; the console shows `monday.com verified the webhook address.`

Rules then decide which of those events go where. It's fine to send everything and let the rules filter it.

## Rules

Rules live in `config.json` (or in the `RULES_JSON` environment variable, for hosts without files). An event goes to every rule that matches it.

```json
{
  "rules": [
    {
      "name": "Ready for deployment",
      "events": ["item_moved"],
      "boards": ["Development"],
      "groups": ["Ready for deployment"],
      "webhook": "env:DISCORD_WEBHOOK_DEPLOYMENTS",
      "title": "{item} is ready for deployment",
      "description": "Moved from {from} by {user}.",
      "colour": "#4C3BFF",
      "mentionRole": "123456789012345678",
      "username": "{board}"
    },
    {
      "name": "Stuck items",
      "events": ["status_changed"],
      "columns": ["Status"],
      "statuses": ["Stuck"],
      "webhook": "env:DISCORD_WEBHOOK_TEAM",
      "colour": "#E2445C"
    }
  ]
}
```

| Setting | Required | What it does |
|---|---|---|
| `name` | | A name for the rule, used in logs |
| `events` | Yes | Any of `item_moved`, `status_changed`, `item_created`, `update_posted` |
| `boards` | | Board names or IDs. Leave out for every board |
| `groups` | | Group names or IDs. For `item_moved`, the group it moved **to**; otherwise the group it's in |
| `statuses` | | `status_changed` only: the new status labels, such as `["Done", "Stuck"]` |
| `columns` | | `status_changed` only: status column names or IDs, if a board has more than one |
| `webhook` | Yes | A Discord webhook URL, or `env:NAME` to read it from an environment variable (recommended) |
| `title` | | Message title. Default depends on the event, such as `{item} moved to {group}` |
| `description` | | Text under the title |
| `colour` | | Hex colour such as `"#5865F2"` |
| `mentionRole` | | A Discord role ID to ping. Nothing else can be pinged |
| `username` | | Name shown on the message, such as `"{board}"`. Defaults to the webhook's own name |
| `avatar` | | An https image URL for the message's avatar |
| `showUser` | | `false` to hide who made the change |
| `showLink` | | `false` to not link the title to the item |

Names are matched ignoring capitals and spaces at either end. Board and group **names** need `MONDAY_API_TOKEN`, because monday.com only sends IDs; without a token, match by ID instead.

**Placeholders** for `title`, `description` and `username`:

| Placeholder | Becomes |
|---|---|
| `{item}` | Item name |
| `{board}` | Board name |
| `{group}`, `{to}` | Group the item is in, or moved to |
| `{from}` | Group it moved from |
| `{status}`, `{previous}` | New and previous status |
| `{column}` | Status column name |
| `{user}` | Who made the change |

**Finding role IDs:** turn on **Developer Mode** in Discord (User Settings → Advanced), then right-click the role in Server Settings → Roles → **Copy Role ID**. The webhook also needs permission to mention that role, or the role must be mentionable.

## Settings

Environment variables, or a `.env` file next to `package.json`:

| Variable | Required | What it does |
|---|---|---|
| `RELAY_SECRET` | Yes | At least 24 letters, numbers, `-` or `_`. Part of the webhook address |
| `MONDAY_API_TOKEN` | Recommended | Looks up names, links and update text |
| `PORT` | | Port to listen on. Default `3000`; most hosts set it for you |
| `CONFIG_PATH` | | Where `config.json` is. Default `config.json` |
| `RULES_JSON` | | The whole rules file as one line, instead of `config.json` |
| `MONDAY_API_VERSION` | | monday.com API version, such as `2025-10`. Default: monday.com's current version |
| `FOOTER_TEXT` | | Footer on every message. Default `Monday to Discord` |
| `DEBUG` | | `true` logs every event in full. Only while setting up; events can include people's details |
| Your webhook variables | | Whatever names your rules use with `env:NAME` |

## Commands

| Command | What it does |
|---|---|
| `npm start` | Starts the server |
| `npm run check` | Checks settings and rules, lists the rules, and exits |
| `npm run test-message` | Sends a sample message for every rule, and exits |
| `npm test` | Runs the automated tests |

## Deploying

### Render

1. Fork this repository (or push your copy to your own GitHub).
2. In Render: **New → Blueprint**, and choose your repository. `render.yaml` sets everything up and generates `RELAY_SECRET`.
3. Fill in `MONDAY_API_TOKEN`, your webhook variables, and `RULES_JSON` (your `config.json` on one line).
4. Your webhook address is `https://<your-service>.onrender.com/monday/<RELAY_SECRET>`; copy the secret from the service's **Environment** tab.

Render's free plan sleeps after a while without traffic, and the first event after that wakes it, which takes a few seconds. monday.com retries if it times out, and repeats are ignored, so nothing is lost; use a paid plan if you want it always on.

### Docker

```bash
docker build -t monday-to-discord .
docker run -d --name monday-to-discord --restart unless-stopped -p 3000:3000 \
  --env-file .env -v "$(pwd)/config.json:/app/config.json:ro" monday-to-discord
```

Put it behind a reverse proxy with HTTPS, such as Caddy, nginx or Cloudflare Tunnel.

### A VPS or game host with Node.js

```bash
npm start
```

To keep it running and restart it on reboot, use PM2:

```bash
npm install -g pm2
pm2 start src/index.js --name monday-to-discord
pm2 save && pm2 startup
```

It needs HTTPS in front of it, such as a reverse proxy or Cloudflare Tunnel.

## Updating

1. Read the [changelog](CHANGELOG.md), especially any **Upgrade notes**.
2. Replace the files with the new release, keeping your `.env` and `config.json`.
3. Run `npm run check`, then restart.

**Replacing monday-discord-relay:** Monday to Discord is its successor. Settings change as follows:

| Old | New |
|---|---|
| `DISCORD_WEBHOOK_URL` | A rule's `webhook` (for example `env:DISCORD_WEBHOOK_URL`) |
| `TARGET_GROUP_NAME` | A rule's `groups` |
| `EMBED_TITLE`, `EMBED_COLOR` | A rule's `title`, `colour` |
| `DISCORD_ROLE_ID` | A rule's `mentionRole` |
| `USE_BOARD_NAME_AS_WEBHOOK_USERNAME` | A rule's `username: "{board}"` |
| `DISCORD_USERNAME` | A rule's `username` |
| `SERVICE_NAME`, `EMBED_FOOTER` | `FOOTER_TEXT` |
| `TEST_ROUTE_ENABLED` | Removed; use `npm run test-message` |
| (none) | `RELAY_SECRET` is now required |

The old setup is the same as this rule:

```json
{ "rules": [ { "events": ["item_moved"], "groups": ["<your TARGET_GROUP_NAME>"], "webhook": "env:DISCORD_WEBHOOK_URL", "title": "Deployment Readiness Confirmed", "username": "{board}" } ] }
```

**Change the webhook address in monday.com** to the new one with your secret: the old `/monday` address no longer works.

## How it works

1. monday.com posts an event to `/monday/<secret>`. Anything without the right secret gets "Not found".
2. If it's a repeat (monday.com retries for up to 30 minutes), it's ignored.
3. It answers monday.com straight away, then, with an API token, looks up names, the link and update text in one request.
4. Each matching rule builds a message. Messages to the same webhook go one at a time; if Discord says to slow down, it waits, and it retries if Discord or the network fails.

It keeps nothing on disk. Repeats are remembered in memory for an hour, so a restart can't cause duplicates unless monday.com retries an event from before it.

## Security and privacy

- **The secret is the lock.** monday.com's board webhooks aren't signed, so the secret in the address is what stops anyone else posting. Keep it private, and change it (and the address in monday.com) if it leaks.
- **Nothing can ping or format.** Text from monday.com is escaped, and Discord is told explicitly that only your `mentionRole` may be pinged.
- **Links are checked.** Titles only ever link to `*.monday.com` addresses.
- **Limits.** Requests over 1 MB are refused, and slow requests time out.
- **Logs** contain item names, board names and IDs, but not tokens, webhook URLs or full events (unless `DEBUG=true`).
- **Personal data.** Messages can include people's names and what they wrote in updates, posted to your Discord. Check that's acceptable for your team and the channels you use.

Please report security problems privately: use the **Report a vulnerability** button in this repository's **Security** tab, or follow our [Security Policy](https://github.com/pigeon-studios-uk/.github/blob/main/SECURITY.md).

## Troubleshooting

**monday.com says the URL couldn't be verified.**
Check the service is running and reachable over HTTPS, and the address ends with `/monday/` followed by your exact `RELAY_SECRET`.

**Nothing is posted.**
Check the logs. "No rule matched" means the event arrived but no rule wanted it: check the board, group and status names in your rules, or set `DEBUG=true` briefly to see the full event. If nothing appears in the logs at all, monday.com isn't reaching the service.

**Board or group names don't match.**
Names need `MONDAY_API_TOKEN`. Without it, use the IDs: a board's ID is in its address, and group IDs appear in the logs with `DEBUG=true`.

**"Discord rejected the message (HTTP 404)".**
The webhook was deleted or the URL is wrong. Create a new one and update the variable.

**The role isn't pinged.**
Check `mentionRole` is the role's ID, and that the role is mentionable or the webhook is allowed to mention it.

**It says it can't start.**
Each problem is listed with how to fix it. `npm run check` shows the same list.

## FAQ

**Does it need a database?**
No. It doesn't store anything.

**Can one service watch several boards and channels?**
Yes: one webhook address for all your boards, and as many rules and Discord webhooks as you like.

**Does it work with monday.com's automations ("When status changes, notify…")?**
It uses monday.com's **Webhooks** integration, not notifications. Each board needs the webhook recipes from [Connecting monday.com](#connecting-mondaycom).

**Is it affiliated with monday.com or Discord?**
No. It uses their public APIs.

## Support

Read [Troubleshooting](#troubleshooting) first, then ask in the support channels of our [Discord](https://discord.gg/2NFVWEUmDF). See [Getting help](https://github.com/pigeon-studios-uk/.github/blob/main/SUPPORT.md).

Found a bug? Open a [bug report](https://github.com/pigeon-studios-uk/monday-to-discord/issues/new/choose).

## Contributing

Fixes and improvements are welcome. Please read the [contributing guide](https://github.com/pigeon-studios-uk/.github/blob/main/CONTRIBUTING.md) first. Run `npm test` before opening a pull request; there's nothing to install.

## Licence

Monday to Discord is free to use under the **[Pigeon Studios Free Licence](LICENSE.md)**.

- ✅ Use it for any number of teams and projects, including commercial ones
- ✅ Change it for your own use
- ✅ Run it for someone you work for
- ❌ Don't reupload, share or mirror the files; link to this repository instead
- ❌ Don't sell it, bundle it, or put it behind a paywall
- ❌ Don't remove the credits

This summary isn't the licence; [LICENSE.md](LICENSE.md) is. Third-party notices are in [NOTICE.md](NOTICE.md).

## Credits

Made by [Pigeon Studios](https://pigeonstudios.co.uk).

<sub>Not affiliated with or endorsed by monday.com Ltd. or Discord Inc. "monday.com" and "Discord" are trademarks of their owners.</sub>
