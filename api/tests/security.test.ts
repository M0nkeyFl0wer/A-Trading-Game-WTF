/**
 * Security-surface tests for issues #3 (bot RCE endpoint unmounted),
 * #9 (CORS allowlist from ALLOWED_ORIGINS, 403 not 500), #17 (helmet config
 * boots in production) and the code half of #15 (DATA_DIR).
 *
 * Env is set BEFORE `../server` is imported because securityHeaders.ts and
 * lib/dataDir.ts read process.env at module load. Vitest isolates each test
 * file in its own module graph, so this does not leak into api.test.ts.
 */
import type { Express } from 'express';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import path from 'node:path';

process.env.AUTH_DEV_BYPASS = 'true';
// One origin from the env plus (because NODE_ENV !== 'production') the
// localhost dev defaults. Whitespace and empty entries must be tolerated.
process.env.ALLOWED_ORIGINS = ' https://trading.example.com , ,http://192.168.1.20:3000';
process.env.DATA_DIR = '/tmp/trading-game-test-data-dir';

// Same mock the other suites use: keeps the bot package out of the picture.
vi.mock('@trading-game/bot', () => ({ SecureBotSandbox: class {} }));

let app: Express;

beforeAll(async () => {
  const mod = await import('../server');
  app = mod.app;
});

describe('issue #3: user-code bot endpoint is not mounted', () => {
  it('POST /api/bot/submit answers 404', async () => {
    const res = await request(app)
      .post('/api/bot/submit')
      .send({ botId: 'x', code: 'function decideTrade(){}' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not Found');
  });

  it('GET /api index no longer advertises /api/bot', async () => {
    const res = await request(app).get('/api');
    expect(res.status).toBe(200);
    expect(res.body.endpoints).not.toHaveProperty('bot');
  });
});

describe('issue #9: CORS allowlist', () => {
  it('builds ONE list from ALLOWED_ORIGINS plus dev defaults outside production', async () => {
    const { allowedOrigins, parseAllowedOrigins } = await import('../middleware/securityHeaders');
    expect(allowedOrigins).toContain('https://trading.example.com');
    expect(allowedOrigins).toContain('http://192.168.1.20:3000');
    expect(allowedOrigins).toContain('http://localhost:3000');
    // In production only the env list counts -- no localhost back door.
    expect(parseAllowedOrigins('https://a.example', 'production')).toEqual(['https://a.example']);
    expect(parseAllowedOrigins(undefined, 'production')).toEqual([]);
  });

  it('listed Origin -> 201 with Access-Control-Allow-Origin', async () => {
    const res = await request(app)
      .post('/api/room/create')
      .set('Origin', 'https://trading.example.com')
      .send({ name: 'CORS ok', maxPlayers: 4 });
    expect(res.status).toBe(201);
    expect(res.headers['access-control-allow-origin']).toBe('https://trading.example.com');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('unlisted Origin -> 403 (not 500) and the handler never runs', async () => {
    const res = await request(app)
      .post('/api/room/create')
      .set('Origin', 'https://evil.example.com')
      .send({ name: 'CORS blocked', maxPlayers: 4 });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();

    // The room must NOT exist: callback(err) short-circuits before the route.
    const list = await request(app).get('/api/rooms');
    expect(list.body.rooms.find((r: any) => r.name === 'CORS blocked')).toBeUndefined();
  });

  it('unlisted Origin preflight -> 403 too', async () => {
    const res = await request(app)
      .options('/api/room/create')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.status).toBe(403);
  });

  it('request with no Origin header (same-origin / curl) still works', async () => {
    const res = await request(app)
      .post('/api/room/create')
      .send({ name: 'No origin', maxPlayers: 4 });
    expect(res.status).toBe(201);
  });
});

describe('issue #17: helmet config is valid in production', () => {
  it('helmet(helmetConfig) does not throw with NODE_ENV=production and no CSP_REPORT_URI', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CSP_REPORT_URI', '');
    try {
      const { helmetConfig, cspConfig } = await import('../middleware/securityHeaders');
      const helmet = (await import('helmet')).default;
      // helmet 8 rejected `reportUri: undefined`; the key must be absent.
      expect(cspConfig.directives).not.toHaveProperty('reportUri');
      expect(helmetConfig).not.toHaveProperty('expectCt');
      expect(() => helmet(helmetConfig as any)).not.toThrow();
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('includes report-uri only when CSP_REPORT_URI is set', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CSP_REPORT_URI', 'https://csp.example.com/report');
    try {
      const { cspConfig } = await import('../middleware/securityHeaders');
      expect(cspConfig.directives).toHaveProperty('reportUri', 'https://csp.example.com/report');
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('production with an empty ALLOWED_ORIGINS refuses to boot', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ALLOWED_ORIGINS', '');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(import('../middleware/securityHeaders')).rejects.toThrow('process.exit(1)');
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('ALLOWED_ORIGINS'));
    } finally {
      exitSpy.mockRestore();
      errSpy.mockRestore();
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

describe('issue #15: DATA_DIR', () => {
  it('signing keys follow DATA_DIR while an explicit DB_PATH still wins', async () => {
    const { DATA_DIR } = await import('../lib/dataDir');
    const { KEY_DIR } = await import('../lib/signing');
    const { DB_PATH } = await import('../services/database');
    expect(DATA_DIR).toBe(path.resolve('/tmp/trading-game-test-data-dir'));
    expect(KEY_DIR).toBe(DATA_DIR);
    // tests/setup.ts sets DB_PATH to a temp file; that override must survive.
    expect(DB_PATH).toBe(process.env.DB_PATH);
    expect(DB_PATH.startsWith(DATA_DIR)).toBe(false);
  });
});
