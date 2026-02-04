import type { Express } from "express";
import type { Server } from "http";
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import request from "supertest";

process.env.AUTH_DEV_BYPASS = "true";
process.env.ELEVENLABS_API_KEY = "test-key";

vi.mock("undici", () => {
  return {
    fetch: vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode("test").buffer,
    })),
  };
});

vi.mock('@trading-game/bot', () => {
  class MockSandbox {
    async executeBot() {
      return { success: true, trade: { price: 100, size: 1 }, executionTime: 5, memoryUsed: 1024 };
    }
    getStats() {
      return { trades: 1 };
    }
    killWorker() {
      return true;
    }
  }
  return { SecureBotSandbox: MockSandbox };
});

let app: Express;
let server: Server;

beforeAll(async () => {
  const mod = await import("../server");
  app = mod.app;
  server = mod.server;
});

afterAll(() => {
  server?.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("API smoke tests", () => {
  it("returns health status with metrics", async () => {
    const response = await request(app).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("status", "healthy");
    expect(response.body).toHaveProperty("metrics");
  });

  it("creates and lists rooms via API", async () => {
    const createResponse = await request(app)
      .post("/api/room/create")
      .send({ name: "Smoke Test Room", maxPlayers: 4 });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.room).toHaveProperty("id");
    const roomId = createResponse.body.room.id;

    const listResponse = await request(app).get("/api/rooms");
    expect(listResponse.status).toBe(200);
    const rooms = listResponse.body.rooms || [];
    const match = rooms.find((room: any) => room.id === roomId);
    expect(match).toBeTruthy();
  });

  it("proxies voice requests through ElevenLabs endpoint", async () => {
    const response = await request(app)
      .post("/api/voice/speak")
      .send({ text: "Hello testers", voiceId: "EXAVITQu4vr4xnSDxMaL" });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("audio");
  });
});
