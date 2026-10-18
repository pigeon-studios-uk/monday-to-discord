#!/usr/bin/env node
/**
 * Monday to Discord: posts monday.com board activity to Discord.
 *
 *   node src/index.js            start the server
 *   node src/index.js check      check the settings and rules, then exit
 *   node src/index.js test       send a sample message for every rule, then exit
 */

import { readFileSync } from 'node:fs';
import { loadDotEnv, loadConfig } from './config.js';
import { createApp } from './app.js';
import { MondayClient } from './monday.js';
import { DiscordSender, buildMessage } from './discord.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const COLOURS = { info: '', warn: '\x1b[33m', error: '\x1b[31m', debug: '\x1b[90m' };
const useColour = process.stdout.isTTY;

function log(level, message) {
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}`;
    const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
    stream.write(useColour && COLOURS[level] ? `${COLOURS[level]}${line}\x1b[0m\n` : `${line}\n`);
}

loadDotEnv();
const command = process.argv[2] ?? 'start';
const { settings, rules, problems } = loadConfig(process.env);

if (problems.length) {
    log('error', `Monday to Discord ${version} can't start:`);
    for (const problem of problems) log('error', `  • ${problem}`);
    process.exit(1);
}

const discord = new DiscordSender({ log });

if (command === 'check') {
    log('info', `Settings and ${rules.length} rule${rules.length === 1 ? '' : 's'} are valid.`);
    for (const rule of rules) log('info', `  • ${rule.name}: ${rule.events.join(', ')}`);
    log('info', settings.mondayToken ? 'A monday.com API token is set, so names will be looked up.' : 'No MONDAY_API_TOKEN: messages will show IDs where monday.com doesn\'t send names.');
    process.exit(0);
}

if (command === 'test') {
    const now = new Date().toISOString();
    const samples = {
        item_moved: { kind: 'item_moved', itemName: 'Sample item', boardName: 'Sample board', fromGroupName: 'In progress', groupName: 'Ready for deployment', userName: 'Monday to Discord', time: now },
        status_changed: { kind: 'status_changed', itemName: 'Sample item', boardName: 'Sample board', columnTitle: 'Status', previousStatus: 'Working on it', status: 'Done', userName: 'Monday to Discord', time: now },
        item_created: { kind: 'item_created', itemName: 'Sample item', boardName: 'Sample board', groupName: 'New requests', userName: 'Monday to Discord', time: now },
        update_posted: { kind: 'update_posted', itemName: 'Sample item', boardName: 'Sample board', groupName: 'In progress', text: 'This is a sample update.', userName: 'Monday to Discord', time: now },
    };
    let failed = 0;
    for (const rule of rules) {
        const ok = await discord.send(rule.webhook, buildMessage(rule, samples[rule.events[0]], { footer: `${settings.footer} · test message` }));
        log(ok ? 'info' : 'error', `${ok ? 'Sent' : 'Failed to send'} a test message for "${rule.name}".`);
        if (!ok) failed++;
    }
    process.exit(failed ? 1 : 0);
}

if (command !== 'start') {
    log('error', `Unknown command "${command}". Use start, check or test.`);
    process.exit(1);
}

const monday = settings.mondayToken ? new MondayClient({ token: settings.mondayToken, apiVersion: settings.mondayApiVersion }) : null;
const server = createApp({ secret: settings.secret, rules, monday, discord, log, debug: settings.debug, footer: settings.footer });

server.listen(settings.port, () => {
    log('info', `Monday to Discord ${version} is listening on port ${settings.port} with ${rules.length} rule${rules.length === 1 ? '' : 's'}.`);
    log('info', 'monday.com webhook address: https://<your-host>/monday/<RELAY_SECRET>');
    if (!monday) log('warn', 'No MONDAY_API_TOKEN: board names, group names and people will show as IDs where monday.com doesn\'t send them.');
});

async function shutdown(signal) {
    log('info', `${signal} received; finishing messages in progress.`);
    server.close();
    await Promise.race([server.drain(), new Promise((r) => setTimeout(r, 10000))]);
    process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
