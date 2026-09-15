// vendored from code-kit@0.6.0, src/ts/pure/model-list-cache.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/* Modell-Listen je Endpunkt, mit Cache und Generationszähler.
 *
 * Herkunft: vault-rag/src/settings.ts (loadModelList/invalidateModelList/modelListGeneration,
 * 0.19.x). Obsidian-frei, deshalb pure/. Instanz statt Modul-Singleton: der Cache gehört zur
 * Lebensdauer eines Settings-Tabs, nicht zum Prozess. */

export interface ModelListResult {
  /** Vom Endpunkt gemeldete Modelle; leer = keine Liste erhalten. */
  models: string[];
  reachable: boolean;
}

/** Genau so viel, wie der Cache von einem Client braucht — bewusst nicht der volle
 *  Chat-/Embedding-Client-Typ eines Consumers. */
export interface ModelListClient {
  listModels(): Promise<string[]>;
  probe(): Promise<{ reachable: boolean }>;
}

export interface ModelListCache {
  /** Liste zu `key`, aus dem Cache oder frisch geholt.
   *
   *  Der Schlüssel muss ALLES einschließen, was das Ergebnis beeinflusst — sonst bekommt ein
   *  anderer Endpunkt die Liste des ersten. In der Endpunkt-Zeile ist er die normalisierte URL
   *  (`normalizeEndpoint(cfg.url)`); ändert sich daran etwas, das die Antwort verändert, ohne
   *  den Schlüssel zu ändern (dort: der API-Schlüssel der Zeile), muss der Aufrufer selbst
   *  `invalidate(key)` rufen. */
  load(key: string, client: ModelListClient | undefined): Promise<ModelListResult>;
  invalidate(key: string): void;
  /** Verwirft ALLE Listen. **Beim Schließen des Settings-Tabs rufen** (`hide()`) — der Cache
   *  hält Promises und überlebt jeden Tab-Neuaufbau bewusst. Ohne diesen Aufruf bleibt ein
   *  einmal als „nicht erreichbar" gemessener Endpunkt für die restliche Sitzung so stehen:
   *  wer seinen LLM-Server startet und die Einstellungen erneut öffnet, sieht dauerhaft den
   *  alten Zustand. Die Pflicht liegt beim Consumer — dieses Modul kennt keinen Tab. */
  clear(): void;
  bump(): number;
  generation(): number;
}

export function createModelListCache(): ModelListCache {
  /** Hält das PROMISE, nicht das Ergebnis: gleichzeitige Aufrufer warten damit auf dieselbe
   *  Anfrage, statt je einen HTTP-Request zu starten. Überlebt bewusst den Tab-Neuaufbau. */
  const lists = new Map<string, Promise<ModelListResult>>();
  let generation = 0;

  const load = (key: string, client: ModelListClient | undefined): Promise<ModelListResult> => {
    const cached = lists.get(key);
    if (cached) return cached;

    let promise: Promise<ModelListResult>;
    if (!client) {
      // Absicherung, kein Produktivpfad: ein Consumer ohne Client liefert einen
      // Offline-Zustand, statt zu werfen.
      promise = Promise.resolve({ models: [], reachable: false });
    } else {
      // Sparsam: eine nicht leere Liste beweist die Erreichbarkeit bereits — nur bei leerer
      // Liste wird zusätzlich geprobt, um „offline" von „gibt keine Liste heraus" zu trennen.
      promise = (async () => {
        const models = await client.listModels();
        const reachable = models.length > 0 ? true : (await client.probe()).reachable;
        return { models, reachable };
      })().catch(() => {
        // Nur den EIGENEN Eintrag verwerfen: lief zwischen Start und Fehlschlag bereits ein
        // invalidate + neues load, steht unter `key` schon ein neueres Promise — das darf
        // dieser Zweig nicht mitreißen.
        if (lists.get(key) === promise) lists.delete(key);
        return { models: [], reachable: false };
      });
    }

    lists.set(key, promise);
    return promise;
  };

  return {
    load,
    invalidate: (key: string): void => { lists.delete(key); },
    clear: (): void => { lists.clear(); },
    bump: (): number => ++generation,
    generation: (): number => generation,
  };
}
