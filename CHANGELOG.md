# Changelog

All notable changes to Monday to Discord are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html):

- **Major** versions can need changes to your settings or rules. Read the **Upgrade notes**.
- **Minor** versions add features without breaking existing setups.
- **Patch** versions fix bugs only.

## [Unreleased]

## [1.0.0] - 2026-10-18

First release. Monday to Discord replaces monday-discord-relay.

### Upgrade notes

- Coming from monday-discord-relay: set `RELAY_SECRET`, move your settings into a rule (the README has a table and an example), and change the webhook address in monday.com to `/monday/<RELAY_SECRET>`.

### Added

- Announcements for items moved between groups, status changes, new items and new updates.
- Rules that route events by board, group, status and column to different Discord webhooks, with their own title, description, colour, name, avatar and role ping.
- Names, item links and update text looked up in monday.com with an API token.
- A secret in the webhook address; requests without it are refused.
- Ignoring monday.com's retries, and posting an event once per webhook even when several rules match.
- Delivery to Discord in order per webhook, with retries and rate-limit handling.
- `check` and `test` commands.
- Rules from `config.json` or the `RULES_JSON` environment variable, and webhooks from environment variables with `env:NAME`.
- A Dockerfile and a Render blueprint.
- Tests for parsing, rules, messages, delivery and the web server, run on Node.js 20, 22 and 24.

### Fixed (compared with monday-discord-relay)

- Item and board names could ping `@everyone` or `@here`.
- Anyone who found the address could post messages through it.
- The test route could be used by anyone when it was turned on.
- Every event was written to the logs in full.

### Removed

- The `/test-discord` route; use `npm run test-message`.
- Dependencies on Express, axios and dotenv.

[Unreleased]: https://github.com/WelshPigeon/monday-to-discord/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/WelshPigeon/monday-to-discord/releases/tag/v1.0.0
