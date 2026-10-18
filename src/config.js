/**
 * Reads settings from environment variables (and a .env file, if present) and rules from config.json.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileRules } from './rules.js';

/** Loads KEY=value lines from a .env file into process.env, without overwriting anything already set. */
export function loadDotEnv(path = '.env', env = process.env) {
    if (!existsSync(path)) return;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
        const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
        if (!match || line.trim().startsWith('#')) continue;
        let value = match[2];
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
        if (env[match[1]] === undefined) env[match[1]] = value;
    }
}

/**
 * Reads every setting. Returns { settings, rules, problems }; any problem means the app shouldn't start.
 * @param {object} env process.env
 */
export function loadConfig(env = process.env) {
    const problems = [];
    const settings = {
        port: Number(env.PORT ?? 3000),
        secret: (env.RELAY_SECRET ?? '').trim(),
        mondayToken: (env.MONDAY_API_TOKEN ?? '').trim() || null,
        mondayApiVersion: (env.MONDAY_API_VERSION ?? '').trim() || null,
        configPath: resolve(env.CONFIG_PATH ?? 'config.json'),
        debug: env.DEBUG === 'true',
        footer: (env.FOOTER_TEXT ?? '').trim() || 'Monday to Discord',
    };

    if (!Number.isInteger(settings.port) || settings.port < 1 || settings.port > 65535) problems.push('PORT must be a port number.');
    if (settings.secret.length < 24) {
        problems.push('RELAY_SECRET must be set to at least 24 random characters. Generate one with: node -e "console.log(crypto.randomBytes(24).toString(\'base64url\'))"');
    } else if (!/^[A-Za-z0-9_-]+$/.test(settings.secret)) {
        problems.push('RELAY_SECRET can only contain letters, numbers, - and _ (it goes in a URL).');
    }

    let config = null;
    let rules = [];
    if (env.RULES_JSON) {
        try {
            config = JSON.parse(env.RULES_JSON);
        } catch (error) {
            problems.push(`RULES_JSON isn't valid JSON: ${error.message}`);
        }
    } else if (!existsSync(settings.configPath)) {
        problems.push(`No rules found. Copy config.example.json to ${settings.configPath} and edit it, or set RULES_JSON.`);
    } else {
        try {
            config = JSON.parse(readFileSync(settings.configPath, 'utf8'));
        } catch (error) {
            problems.push(`${settings.configPath} isn't valid JSON: ${error.message}`);
        }
    }

    if (config) {
        const compiled = compileRules(config, env);
        rules = compiled.rules;
        problems.push(...compiled.problems);
    }

    return { settings, rules, problems };
}
