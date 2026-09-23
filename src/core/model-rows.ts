import { familyFromName, type FamilyId } from "../vendor/kit/sampling-profiles";
import type { ApiModelInfo } from "../vendor/kit/endpoint-source";
import type { ManagedEndpoint } from "./model";

export interface ModelRow { id: string; family?: FamilyId; suggested: FamilyId | null; aliasOf?: string }

export function modelRows(listed: string[], stored: ApiModelInfo[] | undefined): ModelRow[] {
  const out: ModelRow[] = [];
  const seen = new Set<string>();
  const push = (id: string, info?: ApiModelInfo): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const row: ModelRow = { id, suggested: info?.family ? null : familyFromName(id) };
    if (info?.family) row.family = info.family;
    if (info?.aliasOf) row.aliasOf = info.aliasOf;
    out.push(row);
  };
  for (const s of stored ?? []) push(s.id, s);
  for (const id of listed) push(id);
  return out;
}

export function setModelMeta(
  ep: ManagedEndpoint, id: string, patch: { family?: FamilyId | null; aliasOf?: string | null },
): ManagedEndpoint {
  const rows = (ep.models ?? []).map((m) => ({ ...m }));
  let row = rows.find((m) => m.id === id);
  if (!row) { row = { id }; rows.push(row); }
  if (patch.family === null) delete row.family; else if (patch.family) row.family = patch.family;
  if (patch.aliasOf === null) delete row.aliasOf;
  else if (patch.aliasOf !== undefined) {
    const a = patch.aliasOf.trim();
    if (a && a !== id) row.aliasOf = a; else delete row.aliasOf;
  }
  const kept = rows.filter((m) => m.family !== undefined || m.aliasOf !== undefined);
  const { models: _old, ...rest } = ep;
  void _old;
  return kept.length ? { ...rest, models: kept } : rest;
}
