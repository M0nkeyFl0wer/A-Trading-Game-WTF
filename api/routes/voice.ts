import { Router, Request, Response } from 'express';
import { fetch } from 'undici';
import crypto from 'crypto';
import {
  validateInput,
  validationSchemas,
  sanitizeInput,
  CHARACTER_VOICES,
  VOICE_SETTINGS,
  DEFAULT_VOICE_STYLE,
  type VoiceStyle,
} from '@trading-game/shared';
import { logger } from '../lib/logger';
import { metrics } from '../lib/metrics';

const router: Router = Router();

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_API_URL = process.env.ELEVENLABS_API_URL ?? 'https://api.elevenlabs.io/v1';

class VoiceCache {
  constructor(private maxEntries = 100, private ttlMs = 5 * 60 * 1000) {}
  private cache = new Map<string, { buffer: Buffer; expires: number }>();

  get(key: string): Buffer | null {
    const item = this.cache.get(key);
    if (!item) {
      return null;
    }
    if (item.expires < Date.now()) {
      this.cache.delete(key);
      return null;
    }
    return item.buffer;
  }

  set(key: string, buffer: Buffer): void {
    if (this.cache.size >= this.maxEntries) {
      const [oldestKey] = this.cache.keys();
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, { buffer, expires: Date.now() + this.ttlMs });
  }
}

const voiceCache = new VoiceCache();
const allowedVoiceIds = new Set(Object.values(CHARACTER_VOICES));
const allowedVoiceStyles = new Set(Object.keys(VOICE_SETTINGS));

const buildCacheKey = (text: string, voiceId: string, style: VoiceStyle): string =>
  crypto.createHash('sha1').update(`${voiceId}:${style}:${text}`).digest('hex');

router.post('/speak', async (req: Request, res: Response) => {
  if (!ELEVENLABS_API_KEY) {
    metrics.recordVoice(false);
    logger.warn({ userId: req.user?.id }, 'Voice service unavailable: missing API key');
    return res.status(503).json({
      error: 'Voice service unavailable',
      message: 'Server is missing ElevenLabs credentials',
    });
  }

  const textValidation = validateInput<string>(req.body?.text, validationSchemas.message);
  if (!textValidation.isValid || !textValidation.data) {
    metrics.recordVoice(false);
    return res.status(400).json({
      error: 'Invalid text',
      message: textValidation.error || 'Text is required',
    });
  }

  const sanitizedText = sanitizeInput(textValidation.data).trim();
  if (!sanitizedText) {
    metrics.recordVoice(false);
    return res.status(400).json({
      error: 'Invalid text',
      message: 'Text cannot be empty after sanitization',
    });
  }

  const requestedVoiceId = typeof req.body?.voiceId === 'string' ? req.body.voiceId : CHARACTER_VOICES.DEALER;
  const voiceId = allowedVoiceIds.has(requestedVoiceId) ? requestedVoiceId : CHARACTER_VOICES.DEALER;

  const requestedStyle = typeof req.body?.style === 'string' ? req.body.style : DEFAULT_VOICE_STYLE;
  const style: VoiceStyle = allowedVoiceStyles.has(requestedStyle)
    ? (requestedStyle as VoiceStyle)
    : DEFAULT_VOICE_STYLE;

  const logContext = {
    userId: req.user?.id,
    voiceId,
    style,
    textLength: sanitizedText.length,
  };

  const cacheKey = buildCacheKey(sanitizedText, voiceId, style);
  const cached = voiceCache.get(cacheKey);
  if (cached) {
    metrics.recordVoice(true);
    logger.debug({ ...logContext, cache: 'hit' }, 'Voice cache hit');
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Voice-Cache', 'HIT');
    return res.send(cached);
  }

  try {
    const response = await fetch(`${ELEVENLABS_API_URL}/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: sanitizedText,
        model_id: 'eleven_turbo_v2',
        voice_settings: VOICE_SETTINGS[style],
      }),
    });

    if (!response.ok) {
      metrics.recordVoice(false);
      const upstreamMessage = await response.text();
      logger.warn({ ...logContext, status: response.status, upstreamMessage }, 'Voice synthesis failed');
      return res.status(response.status).json({
        error: 'Voice synthesis failed',
        message: upstreamMessage,
      });
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    voiceCache.set(cacheKey, buffer);

    metrics.recordVoice(true);
    logger.info({ ...logContext }, 'Voice synthesis success');

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Voice-Cache', 'MISS');
    return res.send(buffer);
  } catch (error) {
    metrics.recordVoice(false);
    logger.error({ ...logContext, err: error }, 'Voice proxy error');
    return res.status(502).json({
      error: 'Voice service error',
      message: 'Failed to contact ElevenLabs',
    });
  }
});

export default router;
