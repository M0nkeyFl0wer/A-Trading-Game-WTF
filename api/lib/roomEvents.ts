import { EventEmitter } from 'events';

export const roomEvents = new EventEmitter();

roomEvents.setMaxListeners(20);

export type RoomEventMap = {
  'room:updated': unknown;
  'room:removed': { id: string };
};

export type RoomEventKey = keyof RoomEventMap;

export const emitRoomUpdated = (room: unknown) => {
  roomEvents.emit('room:updated', room);
};

export const emitRoomRemoved = (payload: { id: string }) => {
  roomEvents.emit('room:removed', payload);
};
