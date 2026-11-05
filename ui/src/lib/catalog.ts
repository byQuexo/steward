// Reads the action catalog (`warden/catalog.yaml`, served as text by `/api/admin/policy`) for
// the what-if form. The catalog is generated and flat (`kind:` then `  name: { … }` lines), so
// a line parser is enough; no YAML dependency in the bundle.

export interface CatalogEntry {
  kind: string;
  name: string;
  scopes: string[];
  sensitivity: string;
  tags: string[];
}

function list(body: string, key: string): string[] {
  const m = new RegExp(`${key}\\s*:\\s*\\[([^\\]]*)\\]`).exec(body);
  if (!m?.[1]) return [];
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function scalar(body: string, key: string): string | undefined {
  const m = new RegExp(`${key}\\s*:\\s*([A-Za-z_-]+)`).exec(body);
  return m?.[1];
}

export function parseCatalog(yaml: string): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  let kind: string | null = null;
  for (const raw of yaml.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const top = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (top && !/^\s/.test(line)) {
      kind = top[1] === 'version' ? null : (top[1] ?? null);
      continue;
    }
    if (!kind) continue;
    const entry = /^\s+(["']?)([^\s:'"]+)\1\s*:\s*\{(.*)\}\s*$/.exec(line);
    if (!entry?.[2]) continue;
    const body = entry[3] ?? '';
    out.push({
      kind,
      name: entry[2],
      scopes: list(body, 'scopes'),
      sensitivity: scalar(body, 'sensitivity') ?? 'read',
      tags: list(body, 'tags'),
    });
  }
  return out.filter((e) => !e.name.includes('*'));
}

/** A starting point for the args editor: fill what the catalog tells us. */
export function exampleArgs(entry: CatalogEntry | undefined, attrs: Record<string, unknown>): Record<string, unknown> {
  if (!entry) return {};
  const args: Record<string, unknown> = {};
  if (entry.tags.includes('tenant-scoped')) {
    const tenants = attrs.tenants;
    args.tenant = Array.isArray(tenants) && typeof tenants[0] === 'string' ? tenants[0] : '';
  }
  return args;
}
