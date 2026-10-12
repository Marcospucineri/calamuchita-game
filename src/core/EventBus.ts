export interface GameEvents {
  'player:mode': { mode: 'driving' | 'onfoot' | 'flying' };
  'poi:discovered': { id: string; name: string; total: number; found: number };
  'location:changed': { label: string; sub: string };
  'toast': { text: string; sub?: string };
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<any>>>();

  on<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(fn);
    return () => this.handlers.get(type)!.delete(fn);
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    this.handlers.get(type)?.forEach((fn) => fn(payload));
  }
}

export const bus = new EventBus();
