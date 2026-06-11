export interface RoomTarget {
  roomId: string;
  propertyId: string;
  name: string;
}

export const TARGETS: RoomTarget[] = [
  { roomId: "427668350", propertyId: "properties/314959805", name: "サイトA" },
  { roomId: "439313802", propertyId: "properties/331972479", name: "サイトB" },
];

export function findTargetByRoom(roomId: string): RoomTarget | undefined {
  return TARGETS.find((t) => t.roomId === roomId);
}
