import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileRules, matchingRules } from '../src/rules.js';

const HOOK = 'https://discord.com/api/webhooks/123456789012345678/abcDEF_-123';
const env = { DISCORD_A: HOOK };

test('example config compiles with webhooks from the environment', async () => {
    const { readFileSync } = await import('node:fs');
    const config = JSON.parse(readFileSync(new URL('../config.example.json', import.meta.url), 'utf8'));
    const { rules, problems } = compileRules(config, { DISCORD_WEBHOOK_DEPLOYMENTS: HOOK, DISCORD_WEBHOOK_TEAM: HOOK });
    assert.deepEqual(problems, []);
    assert.equal(rules.length, 4);
    assert.equal(rules[0].colour, 0x4c3bff);
    assert.equal(rules[0].webhook, HOOK);
});

test('every mistake is explained, and bad rules are left out', () => {
    const { rules, problems } = compileRules({
        rules: [
            { name: 'ok', events: ['item_moved'], webhook: 'env:DISCORD_A' },
            { name: 'bad', events: ['item_deleted'], webhook: 'http://example.com', colour: 'red', mentionRole: '@here', extra: 1 },
            { name: 'missing env', events: ['item_created'], webhook: 'env:NOPE' },
            { events: [], webhook: HOOK },
        ],
    }, env);
    assert.equal(rules.length, 1);
    const text = problems.join('\n');
    assert.match(text, /"item_deleted" isn't one of/);
    assert.match(text, /must be a Discord webhook URL/);
    assert.match(text, /colour must be a hex colour/);
    assert.match(text, /mentionRole must be a Discord role ID/);
    assert.match(text, /unknown setting "extra"/);
    assert.match(text, /environment variable NOPE, which isn't set/);
    assert.match(text, /events must list at least one/);
});

test('missing or empty rules list', () => {
    assert.match(compileRules({}, env).problems[0], /must contain a "rules" list/);
    assert.match(compileRules({ rules: [] }, env).problems[0], /no rules/);
});

const rules = compileRules({
    rules: [
        { name: 'deploy', events: ['item_moved'], boards: ['Development'], groups: ['Ready for deployment'], webhook: HOOK },
        { name: 'stuck', events: ['status_changed'], statuses: ['stuck'], columns: ['Status'], webhook: HOOK },
        { name: 'any new', events: ['item_created'], webhook: HOOK },
        { name: 'by id', events: ['item_moved', 'item_created'], boards: ['555'], webhook: HOOK },
    ],
}, env).rules;
const names = (event) => matchingRules(rules, event).map((r) => r.name).join(',');

test('matches by board and group names, ignoring case', () => {
    assert.equal(names({ kind: 'item_moved', boardName: 'development', groupName: 'READY FOR DEPLOYMENT' }), 'deploy');
});

test('matches by IDs', () => {
    assert.equal(names({ kind: 'item_moved', boardId: '555', groupName: 'Somewhere' }), 'by id');
});

test('a move to another group doesn\'t match', () => {
    assert.equal(names({ kind: 'item_moved', boardName: 'Development', groupName: 'In progress' }), '');
});

test('status rules check the status and the column', () => {
    assert.equal(names({ kind: 'status_changed', status: 'Stuck', columnTitle: 'Status' }), 'stuck');
    assert.equal(names({ kind: 'status_changed', status: 'Done', columnTitle: 'Status' }), '');
    assert.equal(names({ kind: 'status_changed', status: 'Stuck', columnTitle: 'Priority' }), '');
});

test('rules with no filters match every event of their kind', () => {
    assert.equal(names({ kind: 'item_created', boardName: 'Anything' }), 'any new');
    assert.equal(names({ kind: 'item_created', boardId: '555' }), 'any new,by id');
});
