import { EventEmitter } from 'events';

export type GameEventType =
  | 'round_deal'
  | 'phase_advance'
  | 'order_submit'
  | 'order_cancel'
  | 'trade_match'
  | 'settlement';

export interface GameEvent {
  type: GameEventType;
  roomId: string;
  roundNumber: number;
  timestamp: number;
  payload: Record<string, unknown>;
}

class GameEventBus extends EventEmitter {
  override emit(event: 'game_event', data: GameEvent): boolean;
  override emit(event: string, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }

  override on(event: 'game_event', listener: (data: GameEvent) => void): this;
  override on(event: string, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener);
  }
}

export const gameEvents = new GameEventBus();
gameEvents.setMaxListeners(20);

export function emitGameEvent(
  type: GameEventType,
  roomId: string,
  roundNumber: number,
  payload: Record<string, unknown> = {},
): void {
  gameEvents.emit('game_event', {
    type,
    roomId,
    roundNumber,
    timestamp: Date.now(),
    payload,
  });
}
