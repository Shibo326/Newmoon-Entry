import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryBehaviorProfileStore,
  ProfileNotFoundError,
  ProfileConflictError,
} from '../behavior-profile-store.js';
import type { BehaviorProfile } from '../../types/config.js';
import type { JSONSchema } from '../../types/registry.js';

function createProfile(overrides: Partial<BehaviorProfile> = {}): BehaviorProfile {
  return {
    agentId: 'agent-1',
    version: 1,
    parameters: { timeout: 5000, retries: 3 },
    lastModified: Date.now(),
    ...overrides,
  };
}

describe('InMemoryBehaviorProfileStore', () => {
  let store: InMemoryBehaviorProfileStore;

  beforeEach(() => {
    store = new InMemoryBehaviorProfileStore();
  });

  describe('load()', () => {
    it('throws ProfileNotFoundError when no profile exists for agent', async () => {
      await expect(store.load('nonexistent')).rejects.toThrow(ProfileNotFoundError);
    });

    it('returns the latest version after saving', async () => {
      const profile = createProfile({ lastModified: 1000 });
      await store.save(profile);

      const loaded = await store.load('agent-1');
      expect(loaded.agentId).toBe('agent-1');
      expect(loaded.version).toBe(1);
      expect(loaded.parameters).toEqual({ timeout: 5000, retries: 3 });
    });

    it('returns the highest version when multiple exist', async () => {
      await store.save(createProfile({ lastModified: 1000 }));
      await store.save(createProfile({ parameters: { timeout: 10000 }, lastModified: 2000 }));

      const loaded = await store.load('agent-1');
      expect(loaded.version).toBe(2);
      expect(loaded.parameters).toEqual({ timeout: 10000 });
    });

    it('returns a copy that does not mutate internal state', async () => {
      await store.save(createProfile({ lastModified: 1000 }));
      const loaded = await store.load('agent-1');
      loaded.parameters.timeout = 99999;

      const reloaded = await store.load('agent-1');
      expect(reloaded.parameters.timeout).toBe(5000);
    });
  });

  describe('save()', () => {
    it('auto-increments version starting at 1', async () => {
      await store.save(createProfile({ lastModified: 1000 }));
      const loaded = await store.load('agent-1');
      expect(loaded.version).toBe(1);
    });

    it('auto-increments version on subsequent saves', async () => {
      await store.save(createProfile({ lastModified: 1000 }));
      await store.save(createProfile({ lastModified: 2000 }));
      await store.save(createProfile({ lastModified: 3000 }));

      const loaded = await store.load('agent-1');
      expect(loaded.version).toBe(3);
    });

    it('throws ProfileConflictError when lastModified is older than stored', async () => {
      await store.save(createProfile({ lastModified: 2000 }));

      await expect(
        store.save(createProfile({ lastModified: 1000 }))
      ).rejects.toThrow(ProfileConflictError);
    });

    it('allows save with equal lastModified (no conflict)', async () => {
      await store.save(createProfile({ lastModified: 1000 }));
      await expect(
        store.save(createProfile({ parameters: { newKey: 'val' }, lastModified: 1000 }))
      ).resolves.not.toThrow();
    });

    it('enforces max 50 keys per profile', async () => {
      const tooManyKeys: Record<string, unknown> = {};
      for (let i = 0; i < 51; i++) {
        tooManyKeys[`key${i}`] = i;
      }

      await expect(
        store.save(createProfile({ parameters: tooManyKeys, lastModified: 1000 }))
      ).rejects.toThrow(/exceeds maximum of 50 keys/);
    });

    it('allows exactly 50 keys', async () => {
      const params: Record<string, unknown> = {};
      for (let i = 0; i < 50; i++) {
        params[`key${i}`] = i;
      }

      await expect(
        store.save(createProfile({ parameters: params, lastModified: 1000 }))
      ).resolves.not.toThrow();
    });

    it('validates against registered schema before saving', async () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          timeout: { type: 'number', minimum: 1000 },
        },
        required: ['timeout'],
      };
      store.registerSchema('agent-1', schema);

      await expect(
        store.save(createProfile({ parameters: { timeout: 500 }, lastModified: 1000 }))
      ).rejects.toThrow(/validation failed/);
    });

    it('retains only the last 10 versions', async () => {
      for (let i = 1; i <= 12; i++) {
        await store.save(createProfile({ parameters: { v: i }, lastModified: i * 1000 }));
      }

      const history = await store.getVersionHistory('agent-1', 20);
      expect(history.length).toBe(10);
      // Oldest retained should be version 3 (versions 1 and 2 pruned)
      expect(history[history.length - 1]!.version).toBe(3);
      // Newest should be version 12
      expect(history[0]!.version).toBe(12);
    });
  });

  describe('getVersionHistory()', () => {
    it('returns empty array for unknown agent', async () => {
      const history = await store.getVersionHistory('unknown');
      expect(history).toEqual([]);
    });

    it('returns versions in descending order (newest first)', async () => {
      await store.save(createProfile({ lastModified: 1000 }));
      await store.save(createProfile({ lastModified: 2000 }));
      await store.save(createProfile({ lastModified: 3000 }));

      const history = await store.getVersionHistory('agent-1');
      expect(history[0]!.version).toBe(3);
      expect(history[1]!.version).toBe(2);
      expect(history[2]!.version).toBe(1);
    });

    it('respects the limit parameter', async () => {
      await store.save(createProfile({ lastModified: 1000 }));
      await store.save(createProfile({ lastModified: 2000 }));
      await store.save(createProfile({ lastModified: 3000 }));

      const history = await store.getVersionHistory('agent-1', 2);
      expect(history.length).toBe(2);
      expect(history[0]!.version).toBe(3);
      expect(history[1]!.version).toBe(2);
    });

    it('defaults to 10 results', async () => {
      for (let i = 1; i <= 10; i++) {
        await store.save(createProfile({ parameters: { v: i }, lastModified: i * 1000 }));
      }

      const history = await store.getVersionHistory('agent-1');
      expect(history.length).toBe(10);
    });
  });

  describe('rollback()', () => {
    it('creates a new version with the target version parameters', async () => {
      await store.save(createProfile({ parameters: { mode: 'v1' }, lastModified: 1000 }));
      await store.save(createProfile({ parameters: { mode: 'v2' }, lastModified: 2000 }));
      await store.save(createProfile({ parameters: { mode: 'v3' }, lastModified: 3000 }));

      const rolled = await store.rollback('agent-1', 1);
      expect(rolled.version).toBe(4);
      expect(rolled.parameters).toEqual({ mode: 'v1' });
    });

    it('does not delete newer versions after rollback', async () => {
      await store.save(createProfile({ parameters: { mode: 'v1' }, lastModified: 1000 }));
      await store.save(createProfile({ parameters: { mode: 'v2' }, lastModified: 2000 }));

      await store.rollback('agent-1', 1);

      const history = await store.getVersionHistory('agent-1');
      // Should have all 3 versions: v1, v2, and the rollback (v3)
      expect(history.length).toBe(3);
      expect(history.map(p => p.version)).toEqual([3, 2, 1]);
    });

    it('throws ProfileNotFoundError for unknown agent', async () => {
      await expect(store.rollback('unknown', 1)).rejects.toThrow(ProfileNotFoundError);
    });

    it('throws ProfileNotFoundError for unknown version', async () => {
      await store.save(createProfile({ lastModified: 1000 }));
      await expect(store.rollback('agent-1', 99)).rejects.toThrow(ProfileNotFoundError);
    });

    it('retains only last 10 versions after rollback', async () => {
      for (let i = 1; i <= 10; i++) {
        await store.save(createProfile({ parameters: { v: i }, lastModified: i * 1000 }));
      }
      // This creates version 11, so version 1 should be pruned
      await store.rollback('agent-1', 5);

      const history = await store.getVersionHistory('agent-1', 20);
      expect(history.length).toBe(10);
      // Version 1 should be gone
      expect(history.every(p => p.version >= 2)).toBe(true);
    });
  });

  describe('validate()', () => {
    it('returns valid when no schema is registered', () => {
      const profile = createProfile();
      const result = store.validate('agent-1', profile);
      expect(result.valid).toBe(true);
    });

    it('validates required fields', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          timeout: { type: 'number' },
          retries: { type: 'number' },
        },
        required: ['timeout', 'retries'],
      };
      store.registerSchema('agent-1', schema);

      const profile = createProfile({ parameters: { timeout: 5000 } });
      const result = store.validate('agent-1', profile);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0]!.fieldPath).toBe('parameters.retries');
      expect(result.errors![0]!.constraint).toBe('required');
      expect(result.errors![0]!.rejectedValue).toBeUndefined();
    });

    it('validates type constraints', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          timeout: { type: 'number' },
        },
      };
      store.registerSchema('agent-1', schema);

      const profile = createProfile({ parameters: { timeout: 'not-a-number' } });
      const result = store.validate('agent-1', profile);

      expect(result.valid).toBe(false);
      expect(result.errors![0]!.fieldPath).toBe('parameters.timeout');
      expect(result.errors![0]!.constraint).toBe('type: number');
      expect(result.errors![0]!.rejectedValue).toBe('not-a-number');
    });

    it('validates minimum constraint', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          timeout: { type: 'number', minimum: 1000 },
        },
      };
      store.registerSchema('agent-1', schema);

      const profile = createProfile({ parameters: { timeout: 500 } });
      const result = store.validate('agent-1', profile);

      expect(result.valid).toBe(false);
      expect(result.errors![0]!.constraint).toBe('minimum: 1000');
      expect(result.errors![0]!.rejectedValue).toBe(500);
    });

    it('validates maximum constraint', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          timeout: { type: 'number', maximum: 30000 },
        },
      };
      store.registerSchema('agent-1', schema);

      const profile = createProfile({ parameters: { timeout: 50000 } });
      const result = store.validate('agent-1', profile);

      expect(result.valid).toBe(false);
      expect(result.errors![0]!.constraint).toBe('maximum: 30000');
      expect(result.errors![0]!.rejectedValue).toBe(50000);
    });

    it('validates string minLength constraint', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 3 },
        },
      };
      store.registerSchema('agent-1', schema);

      const profile = createProfile({ parameters: { name: 'ab' } });
      const result = store.validate('agent-1', profile);

      expect(result.valid).toBe(false);
      expect(result.errors![0]!.constraint).toBe('minLength: 3');
    });

    it('validates string enum constraint', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['fast', 'slow'] },
        },
      };
      store.registerSchema('agent-1', schema);

      const profile = createProfile({ parameters: { mode: 'turbo' } });
      const result = store.validate('agent-1', profile);

      expect(result.valid).toBe(false);
      expect(result.errors![0]!.constraint).toContain('enum');
      expect(result.errors![0]!.rejectedValue).toBe('turbo');
    });

    it('validates string pattern constraint', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'string', pattern: '^agent-\\d+$' },
        },
      };
      store.registerSchema('agent-1', schema);

      const profile = createProfile({ parameters: { id: 'bad-format' } });
      const result = store.validate('agent-1', profile);

      expect(result.valid).toBe(false);
      expect(result.errors![0]!.constraint).toContain('pattern');
    });

    it('rejects additional properties when additionalProperties is false', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          timeout: { type: 'number' },
        },
        additionalProperties: false,
      };
      store.registerSchema('agent-1', schema);

      const profile = createProfile({ parameters: { timeout: 5000, unknownKey: 'val' } });
      const result = store.validate('agent-1', profile);

      expect(result.valid).toBe(false);
      expect(result.errors![0]!.fieldPath).toBe('parameters.unknownKey');
      expect(result.errors![0]!.constraint).toBe('additionalProperties');
    });

    it('returns multiple errors at once', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          timeout: { type: 'number', minimum: 1000 },
          retries: { type: 'number', maximum: 10 },
        },
        required: ['timeout', 'retries'],
      };
      store.registerSchema('agent-1', schema);

      const profile = createProfile({ parameters: { timeout: 500, retries: 20 } });
      const result = store.validate('agent-1', profile);

      expect(result.valid).toBe(false);
      expect(result.errors!.length).toBeGreaterThanOrEqual(2);
    });

    it('accepts a valid profile', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          timeout: { type: 'number', minimum: 1000, maximum: 30000 },
          retries: { type: 'number', minimum: 0, maximum: 10 },
          mode: { type: 'string', enum: ['fast', 'slow'] },
        },
        required: ['timeout'],
      };
      store.registerSchema('agent-1', schema);

      const profile = createProfile({ parameters: { timeout: 5000, retries: 3, mode: 'fast' } });
      const result = store.validate('agent-1', profile);

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });
  });

  describe('registerSchema()', () => {
    it('registers a schema for an agent', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { timeout: { type: 'number' } },
      };
      store.registerSchema('agent-1', schema);

      // Schema is now used by validate
      const profile = createProfile({ parameters: { timeout: 'bad' } });
      const result = store.validate('agent-1', profile);
      expect(result.valid).toBe(false);
    });

    it('overwrites previous schema for the same agent', () => {
      store.registerSchema('agent-1', {
        type: 'object',
        properties: { timeout: { type: 'string' } },
      });
      store.registerSchema('agent-1', {
        type: 'object',
        properties: { timeout: { type: 'number' } },
      });

      // Should validate against the new schema (number)
      const profile = createProfile({ parameters: { timeout: 5000 } });
      const result = store.validate('agent-1', profile);
      expect(result.valid).toBe(true);
    });
  });

  describe('concurrent update handling', () => {
    it('latest timestamp wins - earlier update is rejected', async () => {
      // First save with timestamp 2000
      await store.save(createProfile({ lastModified: 2000 }));

      // Attempt to save with older timestamp 1000
      await expect(
        store.save(createProfile({ lastModified: 1000 }))
      ).rejects.toThrow(ProfileConflictError);

      // The profile with timestamp 2000 is still the latest
      const loaded = await store.load('agent-1');
      expect(loaded.lastModified).toBe(2000);
    });

    it('allows subsequent save with newer timestamp', async () => {
      await store.save(createProfile({ lastModified: 1000 }));
      await store.save(createProfile({ parameters: { updated: true }, lastModified: 2000 }));

      const loaded = await store.load('agent-1');
      expect(loaded.lastModified).toBe(2000);
      expect(loaded.parameters).toEqual({ updated: true });
    });
  });

  describe('integer type validation', () => {
    it('validates integer type correctly', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          count: { type: 'integer' },
        },
      };
      store.registerSchema('agent-1', schema);

      // Integer should pass
      const validProfile = createProfile({ parameters: { count: 5 } });
      expect(store.validate('agent-1', validProfile).valid).toBe(true);

      // Float should fail
      const invalidProfile = createProfile({ parameters: { count: 5.5 } });
      const result = store.validate('agent-1', invalidProfile);
      expect(result.valid).toBe(false);
      expect(result.errors![0]!.constraint).toBe('type: integer');
    });
  });
});
