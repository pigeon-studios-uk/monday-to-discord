/**
 * Reads and checks the rules in config.json, and decides which rules match an event.
 *
 * A rule says: for these kinds of event, on these boards, in these groups or with these statuses,
 * send this message to this Discord webhook.
 */

export const KINDS = ['item_moved', 'status_changed', 'item_created', 'update_posted'];

const WEBHOOK_RE = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;
const ENV_RE = /^env:([A-Z][A-Z0-9_]*)$/;
const ALLOWED = new Set(['name', 'events', 'boards', 'groups', 'statuses', 'columns', 'webhook', 'title', 'description', 'colour', 'color', 'mentionRole', 'username', 'avatar', 'showUser', 'showLink']);

/** Matches either an ID or a name, ignoring case and surrounding spaces. */
function matches(list, ...candidates) {
    if (!list || list.length === 0) return true;
    const wanted = list.map((value) => String(value).trim().toLowerCase());
    return candidates.some((candidate) => candidate !== null && candidate !== undefined && wanted.includes(String(candidate).trim().toLowerCase()));
}

function parseColour(value, problems, where) {
    if (value === undefined) return undefined;
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffff) return value;
    if (typeof value === 'string' && /^#?[0-9a-f]{6}$/i.test(value)) return parseInt(value.replace('#', ''), 16);
    problems.push(`${where}.colour must be a hex colour such as "#5865F2".`);
    return undefined;
}

function stringList(value, problems, where) {
    if (value === undefined) return [];
    if (!Array.isArray(value) || !value.every((v) => (typeof v === 'string' && v.trim() !== '') || typeof v === 'number')) {
        problems.push(`${where} must be a list of names or IDs, such as ["Ready for deployment"].`);
        return [];
    }
    return value.map(String);
}

/**
 * Checks the config and returns { rules, problems }. Rules with problems are left out.
 * @param {object} config parsed config.json
 * @param {object} env process.env, for "env:NAME" webhooks
 */
export function compileRules(config, env = {}) {
    const problems = [];
    const rules = [];

    if (!config || typeof config !== 'object' || !Array.isArray(config.rules)) {
        return { rules, problems: ['config.json must contain a "rules" list.'] };
    }

    config.rules.forEach((raw, index) => {
        const where = `rules[${index}]${raw && typeof raw.name === 'string' ? ` ("${raw.name}")` : ''}`;
        const before = problems.length;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            problems.push(`${where} must be an object.`);
            return;
        }

        for (const key of Object.keys(raw)) {
            if (!ALLOWED.has(key)) problems.push(`${where} has an unknown setting "${key}".`);
        }

        const events = stringList(raw.events, problems, `${where}.events`);
        if (events.length === 0) problems.push(`${where}.events must list at least one of: ${KINDS.join(', ')}.`);
        for (const kind of events) {
            if (!KINDS.includes(kind)) problems.push(`${where}.events: "${kind}" isn't one of ${KINDS.join(', ')}.`);
        }

        let webhook = typeof raw.webhook === 'string' ? raw.webhook.trim() : '';
        const fromEnv = ENV_RE.exec(webhook);
        if (fromEnv) {
            webhook = (env[fromEnv[1]] ?? '').trim();
            if (!webhook) problems.push(`${where}.webhook uses the environment variable ${fromEnv[1]}, which isn't set.`);
        }
        if (webhook && !WEBHOOK_RE.test(webhook)) problems.push(`${where}.webhook must be a Discord webhook URL, or "env:NAME" to read one from an environment variable.`);
        if (!raw.webhook) problems.push(`${where}.webhook is required.`);

        const mentionRole = raw.mentionRole === undefined || raw.mentionRole === null ? null : String(raw.mentionRole);
        if (mentionRole !== null && !/^\d{15,22}$/.test(mentionRole)) problems.push(`${where}.mentionRole must be a Discord role ID (a long number), or left out.`);

        for (const key of ['title', 'description', 'username', 'avatar']) {
            if (raw[key] !== undefined && typeof raw[key] !== 'string') problems.push(`${where}.${key} must be text.`);
        }
        if (raw.avatar && !/^https:\/\//.test(raw.avatar)) problems.push(`${where}.avatar must be an https image URL.`);

        const rule = {
            name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : `Rule ${index + 1}`,
            events,
            boards: stringList(raw.boards, problems, `${where}.boards`),
            groups: stringList(raw.groups, problems, `${where}.groups`),
            statuses: stringList(raw.statuses, problems, `${where}.statuses`),
            columns: stringList(raw.columns, problems, `${where}.columns`),
            webhook,
            title: raw.title,
            description: raw.description,
            colour: parseColour(raw.colour ?? raw.color, problems, where),
            mentionRole,
            username: raw.username,
            avatar: raw.avatar,
            showUser: raw.showUser !== false,
            showLink: raw.showLink !== false,
        };

        if (problems.length === before) rules.push(rule);
    });

    if (config.rules.length === 0) problems.push('config.json has no rules, so nothing will be sent.');
    return { rules, problems };
}

/**
 * The rules that match an event. Board and group names are only known after looking them up in monday.com,
 * so pass the enriched event (see monday.js) when an API token is set.
 */
export function matchingRules(rules, event) {
    return rules.filter((rule) => {
        if (!rule.events.includes(event.kind)) return false;
        if (!matches(rule.boards, event.boardId, event.boardName)) return false;
        // For moves, the group is where the item went; for everything else, the group it's in.
        if (!matches(rule.groups, event.groupId, event.groupName)) return false;
        if (event.kind === 'status_changed') {
            if (!matches(rule.statuses, event.status)) return false;
            if (!matches(rule.columns, event.columnId, event.columnTitle)) return false;
        }
        return true;
    });
}
