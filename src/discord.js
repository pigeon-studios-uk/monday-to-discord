/**
 * Builds Discord messages for events, and sends them.
 *
 * Everything that comes from monday.com is escaped so it can't break formatting or mention anyone; only the
 * role in the rule's `mentionRole` can be pinged. Messages stay within Discord's embed limits.
 */

// https://discord.com/developers/docs/resources/message#embed-object-embed-limits
export const LIMITS = { title: 256, description: 4096, fieldName: 256, fieldValue: 1024, footer: 2048, username: 80, total: 6000 };

const DEFAULTS = {
    item_moved: { title: '{item} moved to {group}', colour: 0x5865f2 },
    status_changed: { title: '{item}: {status}', colour: 0x00c875 },
    item_created: { title: 'New item: {item}', colour: 0x579bfc },
    update_posted: { title: 'New update on {item}', colour: 0xa25ddc },
};

/** Shortens text to `limit` characters, adding an ellipsis. Counts characters, not bytes. */
export function truncate(text, limit) {
    const chars = Array.from(String(text ?? ''));
    if (chars.length <= limit) return chars.join('');
    return `${chars.slice(0, limit - 1).join('').trimEnd()}…`;
}

/** Escapes Discord markdown and stops mentions in text that came from monday.com. */
export function escape(text) {
    return String(text ?? '')
        .replace(/[\\`*_~|>#\-[\]()]/g, (c) => `\\${c}`)
        .replace(/@/g, '@\u200b')
        .replace(/<(?=[@#:at])/g, '<\u200b');
}

/** Fills {placeholders} in a rule's text, escaping each value. Unknown placeholders are left as they are. */
export function fill(template, values) {
    return String(template).replace(/\{(\w+)\}/g, (whole, key) => (key in values ? escape(values[key] ?? '?') : whole));
}

/** The values available to {placeholders} in titles, descriptions and usernames. */
function valuesFor(event) {
    return {
        item: event.itemName ?? `Item ${event.itemId ?? '?'}`,
        board: event.boardName ?? `Board ${event.boardId ?? '?'}`,
        group: event.groupName ?? event.groupId ?? '?',
        from: event.fromGroupName ?? event.fromGroupId ?? '?',
        to: event.groupName ?? event.groupId ?? '?',
        status: event.status ?? '?',
        previous: event.previousStatus ?? 'none',
        column: event.columnTitle ?? event.columnId ?? 'Status',
        user: event.userName ?? (event.userId ? `User ${event.userId}` : 'Someone'),
    };
}

function discordTime(iso) {
    const ms = Date.parse(iso ?? '');
    return Number.isFinite(ms) ? `<t:${Math.floor(ms / 1000)}:f>` : null;
}

/**
 * Builds the webhook payload for one rule and one event.
 * @returns {object} JSON body for a Discord webhook
 */
export function buildMessage(rule, event, { footer = 'Monday to Discord' } = {}) {
    const values = valuesFor(event);
    const defaults = DEFAULTS[event.kind];
    const fields = [];
    const add = (name, value, inline = true) => {
        if (value) fields.push({ name: truncate(name, LIMITS.fieldName), value: truncate(value, LIMITS.fieldValue), inline });
    };

    add('Board', escape(values.board));
    if (event.kind === 'item_moved') {
        add('From', escape(values.from));
        add('To', escape(values.to));
    } else if (event.kind === 'status_changed') {
        add(escape(values.column), `${escape(values.previous)} → **${escape(values.status)}**`);
        if (event.groupName || event.groupId) add('Group', escape(values.group));
    } else {
        add('Group', escape(values.group));
    }
    if (rule.showUser !== false) add('By', escape(values.user));
    const when = discordTime(event.time);
    if (when) add('When', when);

    let description = rule.description ? fill(rule.description, values) : '';
    if (event.kind === 'update_posted' && event.text) {
        const quoted = escape(event.text).split('\n').map((line) => `> ${line}`).join('\n');
        description = description ? `${description}\n\n${quoted}` : quoted;
    }

    const embed = {
        title: truncate(fill(rule.title ?? defaults.title, values).replace(/\\/g, ''), LIMITS.title),
        color: rule.colour ?? defaults.colour,
        fields,
        footer: { text: truncate(footer, LIMITS.footer) },
        timestamp: new Date(Date.parse(event.time ?? '') || Date.now()).toISOString(),
    };
    if (description) embed.description = truncate(description, LIMITS.description);
    if (rule.showLink !== false && event.itemUrl && /^https:\/\/[\w.-]+\.monday\.com\//.test(event.itemUrl)) embed.url = event.itemUrl;

    // Keep the whole embed within Discord's 6000-character total by shortening the description first.
    const size = () => embed.title.length + (embed.description?.length ?? 0) + embed.footer.text.length
        + fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
    if (size() > LIMITS.total && embed.description) {
        embed.description = truncate(embed.description, Math.max(0, embed.description.length - (size() - LIMITS.total)));
    }

    const payload = {
        embeds: [embed],
        allowed_mentions: { parse: [], roles: rule.mentionRole ? [rule.mentionRole] : [] },
    };
    if (rule.mentionRole) payload.content = `<@&${rule.mentionRole}>`;
    if (rule.username) payload.username = truncate(fill(rule.username, values).replace(/\\/g, ''), LIMITS.username);
    if (rule.avatar) payload.avatar_url = rule.avatar;
    return payload;
}

/**
 * Sends webhook messages one at a time per webhook, retrying when Discord rate-limits or fails.
 */
export class DiscordSender {
    /**
     * @param {object} [options]
     * @param {Function} [options.fetch]
     * @param {Function} [options.sleep] (ms) => Promise, for tests
     * @param {Function} [options.log]
     * @param {number} [options.attempts] tries per message
     */
    constructor({ fetch: fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = () => {}, attempts = 4 } = {}) {
        this.fetch = fetchImpl;
        this.sleep = sleep;
        this.log = log;
        this.attempts = attempts;
        this.queues = new Map();
    }

    /** Queues a message. Resolves true when Discord accepted it, false if it gave up. */
    send(webhook, payload) {
        const previous = this.queues.get(webhook) ?? Promise.resolve();
        const next = previous.then(() => this.#deliver(webhook, payload));
        this.queues.set(webhook, next.catch(() => {}));
        return next;
    }

    async #deliver(webhook, payload) {
        for (let attempt = 1; attempt <= this.attempts; attempt++) {
            let response;
            try {
                response = await this.fetch(`${webhook}?wait=true`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal: AbortSignal.timeout(10000),
                });
            } catch (error) {
                this.log('warn', `Couldn't reach Discord (${error.message}), attempt ${attempt} of ${this.attempts}.`);
                await this.sleep(1000 * 2 ** attempt);
                continue;
            }

            if (response.ok) return true;

            if (response.status === 429) {
                let wait = 2000;
                try {
                    const body = await response.json();
                    if (typeof body.retry_after === 'number') wait = Math.ceil(body.retry_after * 1000) + 250;
                } catch { /* use the default */ }
                this.log('warn', `Discord asked us to slow down; waiting ${Math.round(wait / 100) / 10}s.`);
                await this.sleep(Math.min(wait, 60000));
                continue;
            }

            if (response.status >= 500) {
                this.log('warn', `Discord returned HTTP ${response.status}, attempt ${attempt} of ${this.attempts}.`);
                await this.sleep(1000 * 2 ** attempt);
                continue;
            }

            // 4xx other than 429: the webhook is wrong or the message was rejected. Retrying won't help.
            let detail = '';
            try { detail = JSON.stringify(await response.json()); } catch { /* no body */ }
            this.log('error', `Discord rejected the message (HTTP ${response.status}). Check the webhook URL. ${detail}`.trim());
            return false;
        }
        this.log('error', `Gave up sending to Discord after ${this.attempts} attempts.`);
        return false;
    }
}
