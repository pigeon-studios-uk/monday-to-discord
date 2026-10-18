import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEvent, kindOf, htmlToText } from '../src/events.js';

// Shapes taken from monday.com's documentation and from the relay this replaces, which ran in production.
const created = { event: { userId: 9603417, originalTriggerUuid: null, boardId: 1771812698, pulseId: 1772099344, pulseName: 'New task item', groupId: 'topics', groupName: 'Group Title', groupColor: '#579bfc', isTopGroup: true, columnValues: {}, app: 'monday', type: 'create_pulse', triggerTime: '2025-01-15T09:07:28.210Z', subscriptionId: 73759690, triggerUuid: 'b5ed2e17c530f43668de130142445cba' } };
const status = { event: { userId: 9603417, originalTriggerUuid: null, boardId: 1771812698, groupId: 'topics', pulseId: 1771812728, pulseName: 'My item', columnId: 'status', columnType: 'color', columnTitle: 'Status', value: { label: { index: 3, text: 'Done', style: { color: '#00c875' } }, post_id: null }, previousValue: { label: { index: 0, text: 'Working on it' } }, changedAt: 1633944017.473193, isTopGroup: true, app: 'monday', type: 'update_column_value', triggerTime: '2025-01-15T09:20:18.022Z', subscriptionId: 73761176, triggerUuid: '504b2eb76c80f672a18f892c0f700e41' } };
const moved = { event: { userId: 1234, boardId: 555, pulseId: 777, pulseName: 'Release 2.0', sourceGroupId: 'new_group', destGroupId: 'ready', destGroup: { title: 'Ready for deployment' }, type: 'move_pulse_into_group', triggerTime: '2026-10-18T10:00:00.000Z', triggerUuid: 'abc' } };
const update = { event: { userId: 42, boardId: 555, pulseId: 777, updateId: 999, body: '<p>Looks good &amp; <b>ready</b></p><p>Ship it</p>', textBody: null, type: 'create_update', triggerUuid: 'upd' } };

test('item created', () => {
    const e = parseEvent(created);
    assert.equal(e.kind, 'item_created');
    assert.equal(e.itemId, '1772099344');
    assert.equal(e.itemName, 'New task item');
    assert.equal(e.boardId, '1771812698');
    assert.equal(e.groupId, 'topics');
    assert.equal(e.groupName, 'Group Title');
    assert.equal(e.userId, '9603417');
    assert.equal(e.id, 'b5ed2e17c530f43668de130142445cba');
});

test('status changed', () => {
    const e = parseEvent(status);
    assert.equal(e.kind, 'status_changed');
    assert.equal(e.status, 'Done');
    assert.equal(e.previousStatus, 'Working on it');
    assert.equal(e.columnId, 'status');
    assert.equal(e.columnTitle, 'Status');
    assert.equal(e.time, '2025-01-15T09:20:18.022Z');
});

test('status changed with no previous value', () => {
    const e = parseEvent({ event: { ...status.event, previousValue: null } });
    assert.equal(e.previousStatus, null);
});

test('non-status column changes are ignored', () => {
    assert.equal(parseEvent({ event: { ...status.event, columnType: 'text' } }), null);
});

test('item moved: the group is the destination', () => {
    const e = parseEvent(moved);
    assert.equal(e.kind, 'item_moved');
    assert.equal(e.groupId, 'ready');
    assert.equal(e.groupName, 'Ready for deployment');
    assert.equal(e.fromGroupId, 'new_group');
});

test('item moved is recognised from its fields even with an unfamiliar type', () => {
    assert.equal(kindOf({ type: 'something_new', destGroupId: 'x' }), 'item_moved');
    assert.equal(kindOf({ type: 'item_moved_to_specific_group' }), 'item_moved');
});

test('update posted: HTML turned into plain text', () => {
    const e = parseEvent(update);
    assert.equal(e.kind, 'update_posted');
    assert.equal(e.updateId, '999');
    assert.equal(e.text, 'Looks good & ready\nShip it');
});

test('htmlToText handles lists, line breaks and entities', () => {
    assert.equal(htmlToText('<ul><li>One</li><li>Two</li></ul>a<br>b &lt;c&gt;'), '• One\n• Two\na\nb <c>');
});

test('unknown or malformed bodies return null', () => {
    assert.equal(parseEvent(null), null);
    assert.equal(parseEvent({}), null);
    assert.equal(parseEvent({ event: 'nope' }), null);
    assert.equal(parseEvent({ event: { type: 'delete_pulse' } }), null);
});

test('snake_case field names are accepted too', () => {
    const e = parseEvent({ event: { type: 'move_pulse_into_group', item_id: 1, board_id: 2, dest_group_id: 'g', source_group_id: 's', user_id: 3 } });
    assert.deepEqual([e.itemId, e.boardId, e.groupId, e.fromGroupId, e.userId], ['1', '2', 'g', 's', '3']);
});
