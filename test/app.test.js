/**
 * End-to-end tests of the web server: a real HTTP server on a random port, with monday.com's API and Discord
 * replaced by fakes.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { compileRules } from '../src/rules.js';
import { MondayClient } from '../src/monday.js';
import { DiscordSender } from '../src/discord.js';

const SECRET = 'test-secret-abcdefghijklmnopqrstuvwxyz';
const HOOK = 'https://discord.com/api/webhooks/123456789012345678/token';

const sent = [];
const mondayCalls = [];
let mondayFails = false;
const logs = [];

const fakeMondayFetch = async (url, init) => {
    mondayCalls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    if (mondayFails) return { ok: false, status: 500, json: async () => ({}) };
    return {
        ok: true,
        status: 200,
        json: async () => ({
            data: {
                items: [{ id: '777', name: 'Release 2.0', url: 'https://acme.monday.com/boards/555/pulses/777', group: { id: 'ready', title: 'Ready for deployment' } }],
                boards: [{ id: '555', name: 'Development', groups: [{ id: 'ready', title: 'Ready for deployment' }, { id: 'wip', title: 'In progress' }] }],
                users: [{ id: '42', name: 'Sam Smith' }],
                updates: [{ id: '999', text_body: 'Ship it' }],
            },
        }),
    };
};

const fakeDiscordFetch = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 204, json: async () => ({}) };
};

let server;
let base;

before(async () => {
    const { rules } = compileRules({
        rules: [
            { name: 'deploy', events: ['item_moved'], boards: ['Development'], groups: ['Ready for deployment'], webhook: HOOK, mentionRole: '123456789012345678' },
            { name: 'deploy twice', events: ['item_moved'], groups: ['Ready for deployment'], webhook: HOOK },
            { name: 'comments', events: ['update_posted'], webhook: HOOK },
        ],
    }, {});
    server = createApp({
        secret: SECRET,
        rules,
        monday: new MondayClient({ token: 'tkn', apiVersion: '2025-10', fetch: fakeMondayFetch }),
        discord: new DiscordSender({ fetch: fakeDiscordFetch, sleep: async () => {} }),
        log: (level, message) => logs.push(`${level} ${message}`),
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const post = (path, body, headers = {}) => fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
});
const settle = () => server.drain();
const moveEvent = (uuid, extra = {}) => ({ event: { type: 'move_pulse_into_group', boardId: 555, pulseId: 777, sourceGroupId: 'wip', destGroupId: 'ready', userId: 42, triggerTime: '2026-10-18T10:00:00.000Z', triggerUuid: uuid, ...extra } });

test('health check', async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok' });
});

test('wrong or missing secret looks like nothing is there', async () => {
    for (const path of ['/monday', '/monday/wrong', `/monday/${SECRET}x`, '/', '/test-discord']) {
        const res = await post(path, { challenge: 'abc' });
        assert.equal(res.status, 404, path);
    }
    assert.equal(sent.length, 0);
});

test('challenge is echoed when monday.com adds the webhook', async () => {
    const res = await post(`/monday/${SECRET}`, { challenge: 'abc123' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { challenge: 'abc123' });
});

test('GET on the webhook address is refused', async () => {
    const res = await fetch(`${base}/monday/${SECRET}`);
    assert.equal(res.status, 405);
});

test('bad JSON and huge bodies are refused', async () => {
    assert.equal((await post(`/monday/${SECRET}`, '{nope')).status, 400);
    const huge = await post(`/monday/${SECRET}`, JSON.stringify({ x: 'a'.repeat(1100000) })).catch(() => ({ status: 413 }));
    assert.equal(huge.status, 413);
});

test('item moved: names looked up, both matching rules, sent once to the shared webhook', async () => {
    sent.length = 0;
    mondayCalls.length = 0;
    const res = await post(`/monday/${SECRET}`, moveEvent('m1'));
    assert.equal(res.status, 200);
    await settle();

    assert.equal(mondayCalls.length, 1);
    assert.equal(mondayCalls[0].headers.Authorization, 'tkn');
    assert.equal(mondayCalls[0].headers['API-Version'], '2025-10');
    assert.deepEqual(mondayCalls[0].body.variables.items, ['777']);

    assert.equal(sent.length, 1, 'the second rule shares the webhook, so it isn\'t posted twice');
    const { body } = sent[0];
    const embed = body.embeds[0];
    assert.equal(embed.title, 'Release 2.0 moved to Ready for deployment');
    assert.equal(embed.url, 'https://acme.monday.com/boards/555/pulses/777');
    const field = (name) => embed.fields.find((f) => f.name === name)?.value;
    assert.equal(field('Board'), 'Development');
    assert.equal(field('From'), 'In progress');
    assert.equal(field('By'), 'Sam Smith');
    assert.equal(body.content, '<@&123456789012345678>');
});

test('monday.com retries of the same event are ignored', async () => {
    sent.length = 0;
    await post(`/monday/${SECRET}`, moveEvent('dup'));
    await post(`/monday/${SECRET}`, moveEvent('dup'));
    await settle();
    assert.equal(sent.length, 1);
    assert.ok(logs.some((l) => l.includes('Ignored a repeat of event dup')));
});

test('a move to a group with no rule sends nothing', async () => {
    sent.length = 0;
    await post(`/monday/${SECRET}`, moveEvent('m2', { destGroupId: 'wip' }));
    await settle();
    assert.equal(sent.length, 0);
});

test('update posted: text is looked up when the webhook doesn\'t include it', async () => {
    sent.length = 0;
    await post(`/monday/${SECRET}`, { event: { type: 'create_update', boardId: 555, pulseId: 777, updateId: 999, userId: 42, triggerUuid: 'u1' } });
    await settle();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body.embeds[0].description, '> Ship it');
});

test('events this app doesn\'t announce are acknowledged and ignored', async () => {
    sent.length = 0;
    const res = await post(`/monday/${SECRET}`, { event: { type: 'delete_pulse', triggerUuid: 'x' } });
    assert.deepEqual(await res.json(), { ok: true, ignored: true });
    await settle();
    assert.equal(sent.length, 0);
});

test('if monday.com\'s API fails, the message still goes out with what the webhook sent', async () => {
    sent.length = 0;
    mondayFails = true;
    await post(`/monday/${SECRET}`, moveEvent('m3', { destGroup: { title: 'Ready for deployment' } }));
    await settle();
    mondayFails = false;
    assert.ok(logs.some((l) => l.includes("Couldn't look up names")));
    // Without the board name, only the rule without a board filter matches.
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body.embeds[0].title, 'Item 777 moved to Ready for deployment');
});
