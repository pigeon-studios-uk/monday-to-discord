import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMessage, escape, truncate, fill, DiscordSender, LIMITS } from '../src/discord.js';

const rule = { name: 'r', showUser: true, showLink: true };

test('escape stops mentions and markdown', () => {
    const text = escape('@everyone **bold** <@123> `code`');
    assert.ok(!text.includes('@everyone'));
    assert.ok(!text.includes('<@123>'));
    assert.ok(text.includes('\\*\\*bold\\*\\*'));
});

test('truncate counts characters and adds an ellipsis within the limit', () => {
    assert.equal(truncate('hello', 10), 'hello');
    const cut = truncate('é'.repeat(50), 10);
    assert.equal(Array.from(cut).length, 10);
    assert.ok(cut.endsWith('…'));
});

test('fill escapes values and leaves unknown placeholders', () => {
    assert.equal(fill('{item} by {nobody}', { item: '@here' }), '@\u200bhere by {nobody}');
});

test('moved message: title, fields, link, timestamp', () => {
    const msg = buildMessage(rule, {
        kind: 'item_moved', itemName: 'Release 2.0', boardName: 'Development', fromGroupName: 'In progress', groupName: 'Ready',
        userName: 'Pigeon', time: '2026-10-18T10:00:00.000Z', itemUrl: 'https://acme.monday.com/boards/1/pulses/2',
    });
    const embed = msg.embeds[0];
    assert.equal(embed.title, 'Release 2.0 moved to Ready');
    assert.deepEqual(embed.fields.map((f) => f.name), ['Board', 'From', 'To', 'By', 'When']);
    assert.equal(embed.fields[4].value, '<t:1792317600:f>');
    assert.equal(embed.url, 'https://acme.monday.com/boards/1/pulses/2');
    assert.equal(embed.timestamp, '2026-10-18T10:00:00.000Z');
    assert.deepEqual(msg.allowed_mentions, { parse: [], roles: [] });
    assert.equal(msg.content, undefined);
});

test('status message shows the change', () => {
    const msg = buildMessage(rule, { kind: 'status_changed', itemName: 'Fix login', boardName: 'B', columnTitle: 'Status', previousStatus: 'Working on it', status: 'Done' });
    assert.equal(msg.embeds[0].title, 'Fix login: Done');
    assert.equal(msg.embeds[0].fields[1].value, 'Working on it → **Done**');
});

test('update message quotes the text', () => {
    const msg = buildMessage(rule, { kind: 'update_posted', itemName: 'X', text: 'Line one\nLine two' });
    assert.equal(msg.embeds[0].description, '> Line one\n> Line two');
});

test('custom title, description, colour, username and role ping', () => {
    const msg = buildMessage({ ...rule, title: '{item} is ready', description: 'From {from} by {user}', colour: 0x123456, username: '{board} bot', mentionRole: '123456789012345678', avatar: 'https://x/a.png' },
        { kind: 'item_moved', itemName: 'Thing', boardName: 'Dev', fromGroupName: 'QA', userName: 'Sam' });
    assert.equal(msg.embeds[0].title, 'Thing is ready');
    assert.equal(msg.embeds[0].description, 'From QA by Sam');
    assert.equal(msg.embeds[0].color, 0x123456);
    assert.equal(msg.username, 'Dev bot');
    assert.equal(msg.content, '<@&123456789012345678>');
    assert.deepEqual(msg.allowed_mentions, { parse: [], roles: ['123456789012345678'] });
    assert.equal(msg.avatar_url, 'https://x/a.png');
});

test('an item named @everyone can\'t ping anyone', () => {
    const msg = buildMessage(rule, { kind: 'item_created', itemName: '@everyone', boardName: '@here' });
    assert.deepEqual(msg.allowed_mentions.parse, []);
    assert.ok(!JSON.stringify(msg).includes('"@everyone'));
});

test('missing names fall back to IDs', () => {
    const msg = buildMessage(rule, { kind: 'item_created', itemId: '77', boardId: '55', userId: '9' });
    assert.equal(msg.embeds[0].title, 'New item: Item 77');
    assert.equal(msg.embeds[0].fields.find((f) => f.name === 'By').value, 'User 9');
});

test('links that aren\'t monday.com are never used', () => {
    const msg = buildMessage(rule, { kind: 'item_created', itemUrl: 'https://evil.example/x' });
    assert.equal(msg.embeds[0].url, undefined);
});

test('huge content stays within every Discord limit', () => {
    const big = 'x'.repeat(10000);
    const msg = buildMessage({ ...rule, description: big, title: big }, { kind: 'update_posted', itemName: big, boardName: big, groupName: big, text: big, userName: big });
    const e = msg.embeds[0];
    assert.ok(Array.from(e.title).length <= LIMITS.title);
    assert.ok(Array.from(e.description).length <= LIMITS.description);
    for (const f of e.fields) assert.ok(f.value.length <= LIMITS.fieldValue);
    const total = e.title.length + e.description.length + e.footer.text.length + e.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
    assert.ok(total <= LIMITS.total, `total ${total}`);
});

function fakeFetch(responses) {
    const calls = [];
    const fn = async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body) });
        const next = responses.shift() ?? { status: 204 };
        if (next.throws) throw new Error(next.throws);
        return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.body ?? {} };
    };
    fn.calls = calls;
    return fn;
}

test('sender: success first time', async () => {
    const fetch = fakeFetch([{ status: 200 }]);
    const sender = new DiscordSender({ fetch, sleep: async () => {} });
    assert.equal(await sender.send('https://discord.com/api/webhooks/1/a', { content: 'hi' }), true);
    assert.equal(fetch.calls.length, 1);
    assert.ok(fetch.calls[0].url.endsWith('?wait=true'));
});

test('sender: waits for retry_after on 429, then succeeds', async () => {
    const waits = [];
    const fetch = fakeFetch([{ status: 429, body: { retry_after: 1.5 } }, { status: 200 }]);
    const sender = new DiscordSender({ fetch, sleep: async (ms) => waits.push(ms) });
    assert.equal(await sender.send('w', {}), true);
    assert.deepEqual(waits, [1750]);
});

test('sender: retries server errors and network failures, then gives up', async () => {
    const logs = [];
    const fetch = fakeFetch([{ status: 502 }, { throws: 'ECONNRESET' }, { status: 500 }, { status: 503 }]);
    const sender = new DiscordSender({ fetch, sleep: async () => {}, log: (level, msg) => logs.push(msg) });
    assert.equal(await sender.send('w', {}), false);
    assert.equal(fetch.calls.length, 4);
    assert.match(logs.at(-1), /Gave up/);
});

test('sender: doesn\'t retry a rejected webhook', async () => {
    const fetch = fakeFetch([{ status: 404, body: { message: 'Unknown Webhook' } }]);
    const logs = [];
    const sender = new DiscordSender({ fetch, sleep: async () => {}, log: (l, m) => logs.push(m) });
    assert.equal(await sender.send('w', {}), false);
    assert.equal(fetch.calls.length, 1);
    assert.match(logs[0], /HTTP 404.*Unknown Webhook/);
});

test('sender: messages to the same webhook go in order', async () => {
    const order = [];
    let release;
    const gate = new Promise((r) => { release = r; });
    const fetch = async (url, init) => {
        const n = JSON.parse(init.body).n;
        if (n === 1) await gate;
        order.push(n);
        return { ok: true, status: 204, json: async () => ({}) };
    };
    const sender = new DiscordSender({ fetch, sleep: async () => {} });
    const a = sender.send('w', { n: 1 });
    const b = sender.send('w', { n: 2 });
    release();
    await Promise.all([a, b]);
    assert.deepEqual(order, [1, 2]);
});
