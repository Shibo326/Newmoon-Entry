/**
 * In-memory Behavior Profile Store implementation.
 * Provides versioned storage, validation, rollback, and conflict detection
 * for agent behavior profiles.
 */

import type {
  BehaviorProfile,
  BehaviorProfileStore,
  ValidationResult,
  ValidationError,
} from '../types/config.js';
import type { JSONSchema } from '../types/registry.js';

/**
 * Error thrown when a profile is not found for the given agent.
 */
export class ProfileNotFoundError extends Error {
  constructor(agentId: string, version?: number) {
    const msg = version !== undefined
      ? `Profile not found for agent "${agentId}" at version ${version}`
      : `Profile not found for agent "${agentId}"`;
    super(msg);
    this.name = 'ProfileNotFoundError';
  }
}

/**
 * Error thrown when a concurrent update conflict is detected.
 * The profile with the latest lastModified timestamp wins.
 */
export class ProfileConflictError extends Error {
  constructor(agentId: string) {
    super(`Concurrent update conflict for agent "${agentId}": a newer version exists`);
    this.name = 'ProfileConflictError';
  }
}

const MAX_KEYS_PER_PROFILE = 50;
const DEFAULT_VERSION_HISTORY_LIMIT = 10;

/**
 * In-memory implementation of BehaviorProfileStore.
 * Stores profiles in memory with version history, schema validation,
 * rollback support, and concurrent update detection.
 */
export class InMemoryBehaviorProfileStore implements BehaviorProfileStore {
  /** Map of agentId -> version-ordered array of profiles (newest last) */
  private profiles: Map<string, BehaviorProfile[]> = new Map();

  /** Map of agentId -> JSON schema for validation */
  private schemas: Map<string, JSONSchema> = new Map();

  /**
   * Register a JSON schema for an agent's behavior profile validation.
   */
  registerSchema(agentId: string, schema: JSONSchema): void {
    this.schemas.set(agentId, schema);
  }

  /**
   * Load the latest (highest version) profile for the given agent.
   * Throws ProfileNotFoundError if no profile exists.
   */
  async load(agentId: string): Promise<BehaviorProfile> {
    const versions = this.profiles.get(agentId);
    if (!versions || versions.length === 0) {
      throw new ProfileNotFoundError(agentId);
    }
    // Return the last entry (highest version)
    return { ...versions[versions.length - 1]!, parameters: { ...versions[versions.length - 1]!.parameters } };
  }

  /**
   * Save a behavior profile.
   * - Validates against the agent's registered schema
   * - Enforces max 50 keys per profile
   * - Auto-increments version number
   * - Detects concurrent updates via lastModified comparison
   * - Retains only the last 10 versions
   *
   * Throws ProfileConflictError if a newer version already exists (based on lastModified).
   */
  async save(profile: BehaviorProfile): Promise<void> {
    const { agentId } = profile;

    // Validate against schema if registered
    const validationResult = this.validate(agentId, profile);
    if (!validationResult.valid) {
      const errorMessages = (validationResult.errors ?? [])
        .map(e => `${e.fieldPath}: ${e.constraint} (got ${JSON.stringify(e.rejectedValue)})`)
        .join('; ');
      throw new Error(`Profile validation failed: ${errorMessages}`);
    }

    // Enforce max 50 keys
    const keyCount = Object.keys(profile.parameters).length;
    if (keyCount > MAX_KEYS_PER_PROFILE) {
      throw new Error(
        `Profile exceeds maximum of ${MAX_KEYS_PER_PROFILE} keys (has ${keyCount})`
      );
    }

    const versions = this.profiles.get(agentId);

    // Concurrent update detection
    if (versions && versions.length > 0) {
      const latest = versions[versions.length - 1]!;
      if (profile.lastModified < latest.lastModified) {
        throw new ProfileConflictError(agentId);
      }
    }

    // Auto-increment version
    const nextVersion = versions && versions.length > 0
      ? versions[versions.length - 1]!.version + 1
      : 1;

    const newProfile: BehaviorProfile = {
      agentId,
      version: nextVersion,
      parameters: { ...profile.parameters },
      lastModified: profile.lastModified,
    };

    if (!versions) {
      this.profiles.set(agentId, [newProfile]);
    } else {
      versions.push(newProfile);
      // Retain only the last 10 versions
      if (versions.length > DEFAULT_VERSION_HISTORY_LIMIT) {
        versions.splice(0, versions.length - DEFAULT_VERSION_HISTORY_LIMIT);
      }
    }
  }

  /**
   * Get version history for an agent, ordered by version descending.
   * Returns at most `limit` versions (default 10).
   */
  async getVersionHistory(agentId: string, limit?: number): Promise<BehaviorProfile[]> {
    const versions = this.profiles.get(agentId);
    if (!versions || versions.length === 0) {
      return [];
    }

    const effectiveLimit = limit ?? DEFAULT_VERSION_HISTORY_LIMIT;
    // Return versions in descending order (newest first)
    return versions
      .slice()
      .reverse()
      .slice(0, effectiveLimit)
      .map(p => ({ ...p, parameters: { ...p.parameters } }));
  }

  /**
   * Rollback to a target version by creating a NEW version entry
   * with the parameters from the target version.
   * Does NOT delete newer versions.
   *
   * Throws ProfileNotFoundError if the target version doesn't exist.
   */
  async rollback(agentId: string, targetVersion: number): Promise<BehaviorProfile> {
    const versions = this.profiles.get(agentId);
    if (!versions || versions.length === 0) {
      throw new ProfileNotFoundError(agentId);
    }

    const targetProfile = versions.find(p => p.version === targetVersion);
    if (!targetProfile) {
      throw new ProfileNotFoundError(agentId, targetVersion);
    }

    // Create a new version entry with the target's parameters
    const latestVersion = versions[versions.length - 1]!.version;
    const newProfile: BehaviorProfile = {
      agentId,
      version: latestVersion + 1,
      parameters: { ...targetProfile.parameters },
      lastModified: Date.now(),
    };

    versions.push(newProfile);
    // Retain only the last 10 versions
    if (versions.length > DEFAULT_VERSION_HISTORY_LIMIT) {
      versions.splice(0, versions.length - DEFAULT_VERSION_HISTORY_LIMIT);
    }

    return { ...newProfile, parameters: { ...newProfile.parameters } };
  }

  /**
   * Validate a profile against the agent-specific JSON schema.
   * Returns field paths, constraints violated, and rejected values.
   *
   * If no schema is registered for the agent, the profile is considered valid.
   */
  validate(agentId: string, profile: BehaviorProfile): ValidationResult {
    const schema = this.schemas.get(agentId);
    if (!schema) {
      return { valid: true };
    }

    const errors: ValidationError[] = [];
    const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
    const required = schema.required as string[] | undefined;

    // Check required fields
    if (required) {
      for (const field of required) {
        if (!(field in profile.parameters)) {
          errors.push({
            fieldPath: `parameters.${field}`,
            constraint: 'required',
            rejectedValue: undefined,
          });
        }
      }
    }

    // Validate property types and constraints
    if (properties) {
      for (const [key, value] of Object.entries(profile.parameters)) {
        const propSchema = properties[key];
        if (!propSchema && schema.additionalProperties === false) {
          errors.push({
            fieldPath: `parameters.${key}`,
            constraint: 'additionalProperties',
            rejectedValue: value,
          });
          continue;
        }

        if (propSchema) {
          this.validateProperty(key, value, propSchema, errors);
        }
      }
    }

    return errors.length === 0
      ? { valid: true }
      : { valid: false, errors };
  }

  /**
   * Validate a single property value against its schema definition.
   */
  private validateProperty(
    key: string,
    value: unknown,
    propSchema: Record<string, unknown>,
    errors: ValidationError[]
  ): void {
    const expectedType = propSchema.type as string | undefined;

    // Type check
    if (expectedType) {
      if (!this.matchesJsonSchemaType(value, expectedType)) {
        errors.push({
          fieldPath: `parameters.${key}`,
          constraint: `type: ${expectedType}`,
          rejectedValue: value,
        });
        return; // Skip further checks if type is wrong
      }
    }

    // Numeric constraints
    if (typeof value === 'number') {
      const minimum = propSchema.minimum as number | undefined;
      const maximum = propSchema.maximum as number | undefined;

      if (minimum !== undefined && value < minimum) {
        errors.push({
          fieldPath: `parameters.${key}`,
          constraint: `minimum: ${minimum}`,
          rejectedValue: value,
        });
      }
      if (maximum !== undefined && value > maximum) {
        errors.push({
          fieldPath: `parameters.${key}`,
          constraint: `maximum: ${maximum}`,
          rejectedValue: value,
        });
      }
    }

    // String constraints
    if (typeof value === 'string') {
      const minLength = propSchema.minLength as number | undefined;
      const maxLength = propSchema.maxLength as number | undefined;
      const pattern = propSchema.pattern as string | undefined;
      const enumValues = propSchema.enum as string[] | undefined;

      if (minLength !== undefined && value.length < minLength) {
        errors.push({
          fieldPath: `parameters.${key}`,
          constraint: `minLength: ${minLength}`,
          rejectedValue: value,
        });
      }
      if (maxLength !== undefined && value.length > maxLength) {
        errors.push({
          fieldPath: `parameters.${key}`,
          constraint: `maxLength: ${maxLength}`,
          rejectedValue: value,
        });
      }
      if (pattern !== undefined && !new RegExp(pattern).test(value)) {
        errors.push({
          fieldPath: `parameters.${key}`,
          constraint: `pattern: ${pattern}`,
          rejectedValue: value,
        });
      }
      if (enumValues !== undefined && !enumValues.includes(value)) {
        errors.push({
          fieldPath: `parameters.${key}`,
          constraint: `enum: [${enumValues.join(', ')}]`,
          rejectedValue: value,
        });
      }
    }

    // Enum constraint for non-string types
    if (typeof value !== 'string' && propSchema.enum !== undefined) {
      const enumValues = propSchema.enum as unknown[];
      if (!enumValues.includes(value)) {
        errors.push({
          fieldPath: `parameters.${key}`,
          constraint: `enum: [${enumValues.map(v => JSON.stringify(v)).join(', ')}]`,
          rejectedValue: value,
        });
      }
    }
  }

  /**
   * Check if a value matches a JSON Schema type.
   * Note: In JSON Schema, 'number' includes integers, but 'integer' excludes floats.
   */
  private matchesJsonSchemaType(value: unknown, expectedType: string): boolean {
    if (value === null) return expectedType === 'null';
    if (Array.isArray(value)) return expectedType === 'array';
    if (typeof value === 'number') {
      if (expectedType === 'number') return true; // number includes integers
      if (expectedType === 'integer') return Number.isInteger(value);
      return false;
    }
    if (typeof value === 'boolean') return expectedType === 'boolean';
    if (typeof value === 'string') return expectedType === 'string';
    if (typeof value === 'object') return expectedType === 'object';
    return false;
  }
}

export default InMemoryBehaviorProfileStore;
