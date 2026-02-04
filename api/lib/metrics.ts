import { EventEmitter } from "events";

interface MetricSnapshot {
  voiceRequests: number;
  voiceFailures: number;
  botExecutions: number;
  botFailures: number;
  roomUpdates: number;
  roomRemovals: number;
  startedAt: number;
}

class Metrics extends EventEmitter {
  private snapshot: MetricSnapshot = {
    voiceRequests: 0,
    voiceFailures: 0,
    botExecutions: 0,
    botFailures: 0,
    roomUpdates: 0,
    roomRemovals: 0,
    startedAt: Date.now(),
  };

  increment<K extends keyof MetricSnapshot>(key: K): void {
    if (key === "startedAt") return;
    this.snapshot[key] = (this.snapshot[key] as number) + 1;
    this.emit("metric", { key, value: this.snapshot[key] });
  }

  recordVoice(success: boolean) {
    this.increment("voiceRequests");
    if (!success) {
      this.increment("voiceFailures");
    }
  }

  recordBot(success: boolean) {
    this.increment("botExecutions");
    if (!success) {
      this.increment("botFailures");
    }
  }

  recordRoomUpdate() {
    this.increment("roomUpdates");
  }

  recordRoomRemoval() {
    this.increment("roomRemovals");
  }

  snapshotMetrics(): MetricSnapshot {
    return { ...this.snapshot };
  }
}

export const metrics = new Metrics();
