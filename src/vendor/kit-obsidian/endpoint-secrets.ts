// vendored from obsidian-kit@0.59.1, src/obsidian/endpoint-secrets.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Schlüsselbund für die LOKALE Endpunkt-Liste eines Plugins ohne Endpoint-Manager.
 *
 *  Die Liste persistiert `secretId` statt `apiKey`; der Schlüssel lebt im Obsidian-Schlüsselbund
 *  (`app.secretStorage`). `apiKey` bleibt ein In-Memory-Feld, das erst `hydrateLocalEndpoints`
 *  füllt — damit `authHeaders` den Schlüssel sieht, ohne dass er je in `data.json` landet.
 *
 *  Namensraum: jeder Schlüssel einer Zeile heißt `<pluginId>-ep-<uuid>`. Eine `secretId`, die in
 *  `data.json` steht (und über Vault-Sync von außen kommen kann), wird nur gelesen oder
 *  geschrieben, wenn sie in diesem Namensraum liegt — sonst könnte eine präparierte Zeile das
 *  Geheimnis eines anderen Plugins als Bearer an eine fremde URL schicken. */
import type { App } from "obsidian";
import { secretIdFor, type SecretStore } from "../kit/secrets";
import { obsidianSecretStore, secretStorageAvailable } from "./secrets";
import { ensureEndpointIds, hydrateEndpointSecrets, migrateEndpointSecrets, type EndpointConfig } from "../kit/endpoint_config";
import type { EndpointSecretHook } from "../kit/endpoint-secret-hook";

/** Präfix aller Zeilen-Schlüssel dieses Plugins (ohne abschließenden Bindestrich). */
export function endpointSecretPrefix(pluginId: string): string {
  return secretIdFor(pluginId, "ep");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Im Namensraum liegt nur `<pluginId>-ep-<uuid>`: das Kit vergibt die Zeilen-Id selbst als UUID.
 *  Ein bloßes Präfix reichte nicht — ein anderes Plugin namens `<pluginId>-ep-x` hätte Schlüssel
 *  im Präfix dieses Plugins. */
function inScope(pluginId: string, id: string): boolean {
  const prefix = `${endpointSecretPrefix(pluginId)}-`;
  return id.startsWith(prefix) && UUID.test(id.slice(prefix.length));
}

/** Store, der nur Schlüssel im Namensraum des Plugins sieht. Außerhalb: `get`/`has` leer,
 *  `delete` ohne Wirkung, `set` wirft. */
export function scopedSecretStore(store: SecretStore, pluginId: string): SecretStore {
  return {
    get: (id) => (inScope(pluginId, id) ? store.get(id) : null),
    has: (id) => inScope(pluginId, id) && store.has(id),
    set: (id, value) => {
      if (!inScope(pluginId, id)) throw new Error(`secretId außerhalb des Namensraums: ${id}`);
      store.set(id, value);
    },
    delete: (id) => { if (inScope(pluginId, id)) store.delete(id); },
  };
}

const newId = (): string => crypto.randomUUID();

/** Zeilen-Ids, die keine UUID sind (von Hand geschrieben, aus einem anderen Stand), tragen
 *  keinen gültigen Schlüsselnamen: sie werden verworfen und beim Setzen/Migrieren neu vergeben. */
function dropForeignIds<T extends EndpointConfig>(list: T[]): T[] {
  return list.map((e) => {
    if (!e.id || UUID.test(e.id)) return e;
    const { id: _drop, ...rest } = e;
    return rest as T;
  });
}

export interface LocalEndpointSecretsOptions<T extends EndpointConfig> {
  app: App;
  pluginId: string;
  /** Die aktuelle Liste des Plugins (dieselbe, die `buildEndpointList` über `get` bekommt). */
  getList(): T[];
  /** Übernimmt die geänderte Liste in die Settings; gespeichert wird danach von der Liste. */
  setList(eps: T[]): void;
}

/** Default-Hook für `buildEndpointList`: Schlüssel über `app.secretStorage`, Liste trägt nur
 *  `id` und `secretId`. Ein noch nicht migrierter Klartext-`apiKey` zählt für `has` als
 *  gespeichert und wird von `clear` entfernt. */
export function localEndpointSecrets<T extends EndpointConfig = EndpointConfig>(
  o: LocalEndpointSecretsOptions<T>,
): EndpointSecretHook<T> {
  const available = secretStorageAvailable(o.app);
  const store = available ? scopedSecretStore(obsidianSecretStore(o.app), o.pluginId) : null;
  const prefix = endpointSecretPrefix(o.pluginId);

  return {
    available,
    has(cfg) {
      if (cfg.apiKey?.trim()) return true;
      return !!(store && cfg.secretId && store.has(cfg.secretId));
    },
    // Promise-Executor statt `async`: ein werfender Schlüsselbund (`set` liest zurück und wirft)
    // wird so zur Ablehnung, die `buildEndpointList` per `.catch` meldet, nicht zur Ausnahme.
    set: (_cfg, index, value) => new Promise<void>((resolve) => {
      if (!store) { resolve(); return; }
      const list = ensureEndpointIds(dropForeignIds(o.getList()), newId) as T[];
      const e = list[index];
      if (!e?.id) { resolve(); return; }
      const secretId = e.secretId && inScope(o.pluginId, e.secretId) ? e.secretId : secretIdFor(prefix, e.id);
      store.set(secretId, value);
      const { apiKey: _drop, ...rest } = e;
      list[index] = { ...rest, secretId } as T;
      o.setList(list);
      resolve();
    }),
    clear: (_cfg, index) => new Promise<void>((resolve) => {
      const list = [...o.getList()];
      const e = list[index];
      if (e) {
        if (store && e.secretId) store.delete(e.secretId);
        const { apiKey: _a, secretId: _s, ...rest } = e;
        list[index] = rest as T;
        o.setList(list);
      }
      resolve();
    }),
    release(cfg) {
      if (store && cfg.secretId) store.delete(cfg.secretId);
    },
  };
}

/** Verschiebt Klartext-Schlüssel der lokalen Liste in den Schlüsselbund. Ohne Schlüsselbund
 *  bleibt alles, wie es ist — es wird nie ein Schlüssel verworfen, der nicht gespeichert wurde. */
export function migrateLocalEndpoints<T extends EndpointConfig>(
  app: App, pluginId: string, list: T[],
): { list: T[]; changed: boolean } {
  if (!secretStorageAvailable(app)) return { list, changed: false };
  const store = scopedSecretStore(obsidianSecretStore(app), pluginId);
  return migrateEndpointSecrets(dropForeignIds(list), store, endpointSecretPrefix(pluginId), newId) as { list: T[]; changed: boolean };
}

/** Kopien der Liste mit `apiKey` aus dem Schlüsselbund — für `authHeaders` und Clients. */
export function hydrateLocalEndpoints<T extends EndpointConfig>(app: App, pluginId: string, list: T[]): T[] {
  if (!secretStorageAvailable(app)) return list.map((e) => ({ ...e }));
  return hydrateEndpointSecrets(list, scopedSecretStore(obsidianSecretStore(app), pluginId), endpointSecretPrefix(pluginId)) as T[];
}

/** Ein Aufruf vor dem Auflösen: migriert (wer den Settings-Tab nie öffnet, migriert trotzdem),
 *  meldet die bereinigte Liste über `persist` zum Speichern und liefert hydrierte Kopien. */
export function prepareLocalEndpoints<T extends EndpointConfig>(o: {
  app: App; pluginId: string; list: T[]; persist?(list: T[]): void | Promise<void>;
}): T[] {
  const m = migrateLocalEndpoints(o.app, o.pluginId, o.list);
  if (m.changed && o.persist) void Promise.resolve(o.persist(m.list)).catch(() => { /* Klartext ist weg, Schlüssel ist im Schlüsselbund; nächster Lauf speichert erneut */ });
  return hydrateLocalEndpoints(o.app, o.pluginId, m.list);
}
