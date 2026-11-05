import { describe, expect, it } from 'vitest';

import { exampleArgs, parseCatalog } from './catalog';

const yaml = `# GENERATED
version: 1

tool:
  # CRM (crm)
  crm.export_deals: { scopes: [crm:export], tags: [tenant-scoped, bulk] }
  crm.update_deal: { scopes: [crm:write], sensitivity: write, tags: [tenant-scoped] }
  docs.search: { scopes: [docs:read] }
  "chat.*": { scopes: [chat:read] }

# --- extra ---
x-memory:
  memory.write:     { scopes: [memory:own], sensitivity: write, tags: [owner-scoped] }

a2a_skill:
  research.deep_search:      { scopes: [research] }
`;

describe('parseCatalog', () => {
  it('reads kinds, names, scopes, sensitivity and tags', () => {
    const c = parseCatalog(yaml);
    expect(c.map((e) => `${e.kind}:${e.name}`)).toEqual([
      'tool:crm.export_deals',
      'tool:crm.update_deal',
      'tool:docs.search',
      'x-memory:memory.write',
      'a2a_skill:research.deep_search',
    ]);
    expect(c[1]).toEqual({ kind: 'tool', name: 'crm.update_deal', scopes: ['crm:write'], sensitivity: 'write', tags: ['tenant-scoped'] });
    expect(c[2]?.sensitivity).toBe('read');
  });

  it('prefills the tenant for tenant-scoped actions', () => {
    const [entry] = parseCatalog(yaml);
    expect(exampleArgs(entry, { tenants: ['dach'] })).toEqual({ tenant: 'dach' });
    expect(exampleArgs(undefined, {})).toEqual({});
  });
});
