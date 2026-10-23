import type { PingId } from './pings';

export const PING_REPEAT_MS = 1200;
export interface TimedPing { ping: PingId; displayId: number; at: number }

export function repeatedPing(previous: TimedPing | null, current: TimedPing): boolean {
  return previous !== null && previous.ping === current.ping && previous.displayId === current.displayId
    && current.at >= previous.at && current.at - previous.at < PING_REPEAT_MS;
}
