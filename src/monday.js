/**
 * Looks up names in monday.com: the board, the item and its link, group titles, the person who made the
 * change, and the text of an update. monday.com's webhooks only send IDs for most of these.
 *
 * Optional: without MONDAY_API_TOKEN, messages use whatever the webhook sent, and IDs where names are missing.
 */

const API_URL = 'https://api.monday.com/v2';

const QUERY = `
query ($items: [ID!], $boards: [ID!], $users: [ID!], $updates: [ID!], $withUpdates: Boolean!, $withUsers: Boolean!) {
  items(ids: $items) { id name url group { id title } }
  boards(ids: $boards) { id name groups { id title } }
  users(ids: $users) @include(if: $withUsers) { id name }
  updates(ids: $updates) @include(if: $withUpdates) { id text_body }
}`;

export class MondayClient {
    /**
     * @param {object} options
     * @param {string} options.token monday.com API token
     * @param {string} [options.apiVersion] API-Version header, such as "2025-10"; monday's current default if left out
     * @param {Function} [options.fetch] fetch implementation (for tests)
     * @param {number} [options.timeoutMs]
     */
    constructor({ token, apiVersion, fetch: fetchImpl = globalThis.fetch, timeoutMs = 10000 }) {
        this.token = token;
        this.apiVersion = apiVersion;
        this.fetch = fetchImpl;
        this.timeoutMs = timeoutMs;
    }

    async query(query, variables) {
        const headers = { Authorization: this.token, 'Content-Type': 'application/json' };
        if (this.apiVersion) headers['API-Version'] = this.apiVersion;
        const response = await this.fetch(API_URL, {
            method: 'POST',
            headers,
            body: JSON.stringify({ query, variables }),
            signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!response.ok) throw new Error(`monday.com API returned HTTP ${response.status}`);
        const body = await response.json();
        if (body.errors?.length) throw new Error(`monday.com API error: ${body.errors.map((e) => e.message).join('; ')}`);
        return body.data ?? {};
    }

    /**
     * Fills in names on an event from parseEvent(). Never throws: if the lookup fails, the event is returned
     * as it was, with `lookupFailed` set.
     */
    async enrich(event) {
        try {
            const data = await this.query(QUERY, {
                items: event.itemId ? [event.itemId] : [],
                boards: event.boardId ? [event.boardId] : [],
                users: event.userId ? [event.userId] : [],
                updates: event.updateId ? [event.updateId] : [],
                withUsers: Boolean(event.userId),
                withUpdates: Boolean(event.updateId),
            });

            const item = data.items?.[0];
            const board = data.boards?.[0];
            const groupTitle = (id) => board?.groups?.find((group) => group.id === id)?.title ?? null;

            return {
                ...event,
                itemName: event.itemName ?? item?.name ?? null,
                itemUrl: item?.url ?? null,
                boardName: board?.name ?? null,
                groupName: event.groupName ?? groupTitle(event.groupId) ?? (event.kind !== 'item_moved' ? item?.group?.title : null) ?? null,
                groupId: event.groupId ?? item?.group?.id ?? null,
                fromGroupName: event.fromGroupName ?? groupTitle(event.fromGroupId),
                userName: data.users?.[0]?.name ?? null,
                text: event.text ?? data.updates?.[0]?.text_body ?? null,
            };
        } catch (error) {
            return { ...event, lookupFailed: error.message };
        }
    }
}
