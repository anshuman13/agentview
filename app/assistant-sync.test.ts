import { describe, it, expect } from 'vitest';
import { FIELDS, rowToChange, mergeIncoming } from './www/assistant-sync.js';

describe('assistant-sync', () => {
  describe('FIELDS', () => {
    it('includes all synced fields', () => {
      expect(FIELDS).toEqual(['title', 'text', 'source', 'source_url', 'people', 'at', 'status']);
    });
  });

  describe('rowToChange', () => {
    it('extracts synced fields and field times', () => {
      const row = {
        id: 'id1',
        profile: 'work',
        updated_at: 1000,
        deleted: 0,
        field_times: '{"title":900}',
        title: 'Task',
        text: 'Description',
        source: 'capture',
        source_url: null,
        people: null,
        at: null,
        status: 'open',
      };
      const change = rowToChange(row);
      expect(change).toEqual({
        table: 'items',
        id: 'id1',
        profile: 'work',
        deleted: false,
        updated_at: 1000,
        fields: {
          title: 'Task',
          text: 'Description',
          source: 'capture',
          source_url: null,
          people: null,
          at: null,
          status: 'open',
        },
        field_times: { title: 900 },
      });
    });

    it('includes deleted time in field_times if deleted', () => {
      const row = {
        id: 'id1',
        profile: 'work',
        updated_at: 1000,
        deleted: 2000,
        field_times: '{}',
        title: null,
        text: null,
        source: null,
        source_url: null,
        people: null,
        at: null,
        status: null,
      };
      const change = rowToChange(row);
      expect(change.deleted).toBe(true);
      expect(change.field_times.deleted).toBe(2000);
    });

    it('handles field_times as object', () => {
      const row = {
        id: 'id1',
        profile: 'work',
        updated_at: 1000,
        deleted: 0,
        field_times: { title: 900 },
        title: 'Task',
        text: null,
        source: null,
        source_url: null,
        people: null,
        at: null,
        status: null,
      };
      const change = rowToChange(row);
      expect(change.field_times).toEqual({ title: 900 });
    });
  });

  describe('mergeIncoming', () => {
    it('uses newer incoming field when incoming is newer', () => {
      const local = {
        id: 'id1',
        profile: 'work',
        updated_at: 1000,
        deleted: 0,
        field_times: { title: 900 },
        title: 'Old',
        text: null,
        status: null,
      };
      const incoming = {
        id: 'id1',
        profile: 'work',
        version: 2,
        updated_at: 2000,
        deleted: 0,
        field_times: { title: 1500 },
        title: 'New',
        text: null,
        status: null,
      };
      const merged = mergeIncoming(local, incoming);
      expect(merged.title).toBe('New');
      expect(merged.dirty).toBe(0);
    });

    it('keeps local field when local is newer', () => {
      const local = {
        id: 'id1',
        profile: 'work',
        updated_at: 2000,
        deleted: 0,
        field_times: { title: 1500 },
        title: 'Local',
        text: null,
        status: null,
      };
      const incoming = {
        id: 'id1',
        profile: 'work',
        version: 2,
        updated_at: 1000,
        deleted: 0,
        field_times: { title: 900 },
        title: 'Incoming',
        text: null,
        status: null,
      };
      const merged = mergeIncoming(local, incoming);
      expect(merged.title).toBe('Local');
      expect(merged.dirty).toBe(1);
    });

    it('keeps local on tie (same time)', () => {
      const local = {
        id: 'id1',
        profile: 'work',
        updated_at: 1000,
        deleted: 0,
        field_times: { title: 1000 },
        title: 'Local',
        text: null,
        status: null,
      };
      const incoming = {
        id: 'id1',
        profile: 'work',
        version: 2,
        updated_at: 1000,
        deleted: 0,
        field_times: { title: 1000 },
        title: 'Incoming',
        text: null,
        status: null,
      };
      const merged = mergeIncoming(local, incoming);
      expect(merged.title).toBe('Local');
      expect(merged.dirty).toBe(0);
    });

    it('merges per-field with different times', () => {
      const local = {
        id: 'id1',
        profile: 'work',
        updated_at: 2000,
        deleted: 0,
        field_times: { title: 2000, text: 1500 },
        title: 'Local Title',
        text: 'Local Text',
        status: null,
      };
      const incoming = {
        id: 'id1',
        profile: 'work',
        version: 2,
        updated_at: 1800,
        deleted: 0,
        field_times: { title: 1800, text: 1800 },
        title: 'Incoming Title',
        text: 'Incoming Text',
        status: 'open',
      };
      const merged = mergeIncoming(local, incoming);
      expect(merged.title).toBe('Local Title');
      expect(merged.text).toBe('Incoming Text');
      expect(merged.status).toBe('open');
      expect(merged.dirty).toBe(1);
    });

    it('inserts new row from incoming when local is null', () => {
      const incoming = {
        id: 'id1',
        profile: 'work',
        version: 1,
        updated_at: 1000,
        deleted: 0,
        field_times: { title: 1000 },
        title: 'New Item',
        text: null,
        status: 'open',
      };
      const merged = mergeIncoming(null, incoming);
      expect(merged.id).toBe('id1');
      expect(merged.title).toBe('New Item');
      expect(merged.status).toBe('open');
      expect(merged.version).toBe(1);
      expect(merged.dirty).toBe(0);
    });

    it('merges deleted flag per-field', () => {
      const local = {
        id: 'id1',
        profile: 'work',
        updated_at: 2000,
        deleted: 1500,
        field_times: { deleted: 1500 },
        title: 'Local',
        text: null,
        status: null,
      };
      const incoming = {
        id: 'id1',
        profile: 'work',
        version: 2,
        updated_at: 1000,
        deleted: 0,
        field_times: {},
        title: 'Incoming',
        text: null,
        status: null,
      };
      const merged = mergeIncoming(local, incoming);
      expect(merged.deleted).toBe(1500);
      expect(merged.field_times.deleted).toBe(1500);
      expect(merged.dirty).toBe(1);
    });

    it('undeletes when incoming is newer without deleted', () => {
      const local = {
        id: 'id1',
        profile: 'work',
        updated_at: 1000,
        deleted: 1500,
        field_times: { deleted: 1500 },
        title: 'Task',
        text: null,
        status: null,
      };
      const incoming = {
        id: 'id1',
        profile: 'work',
        version: 2,
        updated_at: 2000,
        deleted: 0,
        field_times: {},
        title: 'Task',
        text: null,
        status: null,
      };
      const merged = mergeIncoming(local, incoming);
      expect(merged.deleted).toBe(0);
      expect(merged.dirty).toBe(0);
    });

    it('uses incoming updated_at when field time missing', () => {
      const incoming = {
        id: 'id1',
        profile: 'work',
        version: 1,
        updated_at: 1500,
        deleted: 0,
        field_times: {},
        title: 'Task',
        text: null,
        status: null,
      };
      const merged = mergeIncoming(null, incoming);
      expect(merged.field_times.title).toBe(1500);
    });

    it('sets version from incoming', () => {
      const incoming = {
        id: 'id1',
        profile: 'work',
        version: 42,
        updated_at: 1000,
        deleted: 0,
        field_times: {},
        title: 'Task',
        text: null,
        status: null,
      };
      const merged = mergeIncoming(null, incoming);
      expect(merged.version).toBe(42);
    });

    it('sets updated_at to max of incoming and local', () => {
      const local = {
        id: 'id1',
        profile: 'work',
        updated_at: 1000,
        deleted: 0,
        field_times: { title: 2000 },
        title: 'Local',
        text: null,
        status: null,
      };
      const incoming = {
        id: 'id1',
        profile: 'work',
        version: 2,
        updated_at: 1500,
        deleted: 0,
        field_times: { text: 1200 },
        title: 'Incoming',
        text: 'Text',
        status: null,
      };
      const merged = mergeIncoming(local, incoming);
      expect(merged.updated_at).toBe(1500);
    });
  });
});
