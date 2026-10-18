/**
 * Turns a monday.com webhook request into a plain event object.
 *
 * monday.com sends different field names for different events (and has changed some over time), so this
 * accepts every name we know of and returns one shape:
 *
 *   {
 *     kind: 'item_moved' | 'status_changed' | 'item_created' | 'update_posted',
 *     id,                      // monday's triggerUuid, used to ignore repeats
 *     boardId, itemId, itemName,
 *     groupId, groupName,      // the group the item is in now (moved: the destination)
 *     fromGroupId, fromGroupName,
 *     columnId, columnTitle, status, previousStatus,
 *     updateId, text,
 *     userId, time,            // ISO time of the change
 *   }
 *
 * Returns null for events this app doesn't announce.
 */

const pick = (...values) => {
    for (const value of values) {
        if (value !== undefined && value !== null && value !== '') return value;
    }
    return null;
};

const asId = (value) => (value === null || value === undefined ? null : String(value));

function labelOf(value) {
    if (!value || typeof value !== 'object') return typeof value === 'string' ? value : null;
    return pick(value.label?.text, value.label, value.text, value.name);
}

/** The kind of event, from monday's `type` and, if that's unfamiliar, from the fields present. */
export function kindOf(event) {
    const type = String(event.type ?? '').toLowerCase();

    if (type === 'create_pulse' || type === 'create_item') return 'item_created';
    if (type === 'create_update') return 'update_posted';
    if (type.includes('move') && type.includes('group')) return 'item_moved';
    if (type === 'update_column_value' || type === 'change_column_value' || type === 'change_status_column_value') {
        const columnType = String(event.columnType ?? '').toLowerCase();
        if (columnType === 'color' || columnType === 'status' || type === 'change_status_column_value') return 'status_changed';
        return null;
    }

    // Unfamiliar type: work it out from the fields.
    if (pick(event.destGroupId, event.destinationGroupId, event.dest_group_id) !== null) return 'item_moved';
    if (pick(event.updateId, event.update_id) !== null) return 'update_posted';
    return null;
}

/**
 * Parses a webhook request body.
 * @param {object} body the JSON body monday.com sent
 * @returns {object|null}
 */
export function parseEvent(body) {
    const event = body && typeof body === 'object' ? body.event : null;
    if (!event || typeof event !== 'object') return null;

    const kind = kindOf(event);
    if (!kind) return null;

    const toGroupId = asId(pick(event.destGroupId, event.destinationGroupId, event.dest_group_id));
    const parsed = {
        kind,
        id: asId(pick(event.triggerUuid, event.originalTriggerUuid)),
        boardId: asId(pick(event.boardId, event.board_id, event.board?.id)),
        itemId: asId(pick(event.pulseId, event.itemId, event.item_id, event.pulse_id, event.pulse?.id, event.item?.id)),
        itemName: pick(event.pulseName, event.itemName, event.pulse?.name, event.item?.name),
        groupId: asId(kind === 'item_moved' ? toGroupId : pick(event.groupId, event.group_id, event.group?.id)),
        groupName: pick(
            kind === 'item_moved' ? pick(event.destGroup?.title, event.dest_group?.title) : null,
            event.groupName,
            event.group?.title,
        ),
        fromGroupId: asId(pick(event.sourceGroupId, event.source_group_id)),
        fromGroupName: pick(event.sourceGroup?.title, event.source_group?.title),
        columnId: asId(pick(event.columnId, event.column_id)),
        columnTitle: pick(event.columnTitle, event.column_title),
        status: kind === 'status_changed' ? labelOf(event.value) : null,
        previousStatus: kind === 'status_changed' ? labelOf(event.previousValue) : null,
        updateId: asId(pick(event.updateId, event.update_id)),
        text: kind === 'update_posted' ? pick(event.textBody, event.text_body, event.body) : null,
        userId: asId(pick(event.userId, event.user_id)),
        time: pick(event.triggerTime, event.changedAt ? new Date(Number(event.changedAt) * 1000).toISOString() : null),
    };

    // HTML in update bodies ("<p>Hi</p>") is turned into plain text.
    if (parsed.text && /<[a-z][\s\S]*>/i.test(parsed.text)) parsed.text = htmlToText(parsed.text);
    return parsed;
}

/** A small, safe HTML-to-text conversion for update bodies. */
export function htmlToText(html) {
    return String(html)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|h\d)>/gi, '\n')
        .replace(/<li[^>]*>/gi, '• ')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
