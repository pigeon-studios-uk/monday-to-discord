/**
 * The web server that monday.com sends webhooks to.
 *
 *   POST /monday/<RELAY_SECRET>   monday.com webhooks (and the one-off challenge when you add the webhook)
 *   GET  /health                  { "status": "ok" } for uptime checks
 *
 * Requests to /monday without the right secret get 404, as if the address didn't exist.
 */

import { createServer } from 'node:http';
import { timingSafeEqual, createHash } from 'node:crypto';
import { parseEvent } from './events.js';
import { matchingRules } from './rules.js';
import { buildMessage } from './discord.js';

const MAX_BODY = 1024 * 1024;
const SEEN_LIMIT = 5000;
const SEEN_MS = 60 * 60 * 1000;

function sameSecret(given, expected) {
    // Compare hashes so the comparison takes the same time whatever the input length.
    const a = createHash('sha256').update(String(given)).digest();
    const b = createHash('sha256').update(String(expected)).digest();
    return timingSafeEqual(a, b);
}

function readBody(request) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        request.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY) {
                reject(Object.assign(new Error('Body too large'), { status: 413 }));
                request.destroy();
                return;
            }
            chunks.push(chunk);
        });
        request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        request.on('error', reject);
    });
}

function send(response, status, body) {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    response.writeHead(status, {
        'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
    });
    response.end(text);
}

/**
 * Creates the server.
 * @param {object} options
 * @param {string} options.secret RELAY_SECRET
 * @param {object[]} options.rules compiled rules
 * @param {import('./monday.js').MondayClient|null} options.monday
 * @param {import('./discord.js').DiscordSender} options.discord
 * @param {Function} options.log (level, message) => void
 * @param {boolean} [options.debug] log every event in full
 * @param {string} [options.footer]
 */
export function createApp({ secret, rules, monday, discord, log, debug = false, footer }) {
    const seen = new Map(); // triggerUuid -> time, to ignore monday.com's retries
    const pending = new Set();

    function alreadySeen(id) {
        if (!id) return false;
        const now = Date.now();
        if (seen.has(id)) return true;
        seen.set(id, now);
        if (seen.size > SEEN_LIMIT) {
            for (const [key, time] of seen) {
                if (now - time > SEEN_MS || seen.size > SEEN_LIMIT) seen.delete(key);
                else break;
            }
        }
        return false;
    }

    async function handle(event) {
        const enriched = monday ? await monday.enrich(event) : event;
        if (enriched.lookupFailed) log('warn', `Couldn't look up names in monday.com: ${enriched.lookupFailed}`);

        const matched = matchingRules(rules, enriched);
        const label = `${enriched.kind} "${enriched.itemName ?? enriched.itemId}" on board ${enriched.boardName ?? enriched.boardId}`;
        if (matched.length === 0) {
            log('info', `No rule matched ${label}.`);
            return;
        }

        const sentTo = new Set();
        for (const rule of matched) {
            // Two rules sending the same event to the same webhook would post it twice; send once.
            if (sentTo.has(rule.webhook)) continue;
            sentTo.add(rule.webhook);
            const ok = await discord.send(rule.webhook, buildMessage(rule, enriched, { footer }));
            log(ok ? 'info' : 'error', `${ok ? 'Sent' : 'Failed to send'} ${label} (rule "${rule.name}").`);
        }
    }

    const server = createServer(async (request, response) => {
        const url = new URL(request.url ?? '/', 'http://localhost');

        if (request.method === 'GET' && url.pathname === '/health') {
            return send(response, 200, { status: 'ok' });
        }

        const match = /^\/monday\/([^/]+)\/?$/.exec(url.pathname);
        if (!match || !sameSecret(decodeURIComponent(match[1]), secret)) {
            return send(response, 404, 'Not found');
        }
        if (request.method !== 'POST') {
            response.setHeader('Allow', 'POST');
            return send(response, 405, 'Use POST');
        }

        let body;
        try {
            body = JSON.parse(await readBody(request));
        } catch (error) {
            return send(response, error.status ?? 400, error.status ? 'Too large' : 'Invalid JSON');
        }

        // monday.com checks the address when a webhook is added by sending a challenge to echo back.
        if (body && typeof body.challenge === 'string') {
            log('info', 'monday.com verified the webhook address.');
            return send(response, 200, { challenge: body.challenge });
        }

        if (debug) log('debug', `Event: ${JSON.stringify(body.event ?? body)}`);

        const event = parseEvent(body);
        if (!event) {
            if (debug) log('debug', `Ignored an event this app doesn't announce (type "${body?.event?.type}").`);
            return send(response, 200, { ok: true, ignored: true });
        }
        if (alreadySeen(event.id)) {
            log('info', `Ignored a repeat of event ${event.id}.`);
            return send(response, 200, { ok: true, duplicate: true });
        }

        // Answer monday.com straight away, so it doesn't time out and send the event again; then do the work.
        send(response, 200, { ok: true });
        const job = handle(event).catch((error) => log('error', `Couldn't handle an event: ${error.stack ?? error}`));
        pending.add(job);
        job.finally(() => pending.delete(job));
    });

    server.requestTimeout = 15000;
    server.headersTimeout = 10000;

    /** Waits for events still being sent (for a clean shutdown). */
    server.drain = () => Promise.allSettled([...pending]);
    return server;
}
