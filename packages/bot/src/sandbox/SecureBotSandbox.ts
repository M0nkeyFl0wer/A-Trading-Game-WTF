import { Worker } from 'worker_threads';
import path from 'path';
import { EventEmitter } from 'events';
import type { MarketData, Trade, BotResult } from '@trading-game/shared';

/**
 * Secure sandbox for executing user-submitted bot code
 * Uses Worker Threads with strict resource limits to prevent malicious code execution
 */

interface SandboxOptions {
  maxExecutionTime?: number; // milliseconds
  maxMemory?: number; // MB
  maxCPU?: number; // percentage
}

interface BotExecutionResult {
  success: boolean;
  trade?: Trade;
  error?: string;
  executionTime: number;
  memoryUsed: number;
}

export class SecureBotSandbox extends EventEmitter {
  private readonly defaultOptions: SandboxOptions = {
    maxExecutionTime: 5000, // 5 seconds
    maxMemory: 50, // 50MB
    maxCPU: 25 // 25% CPU
  };

  private activeWorkers: Map<string, Worker> = new Map();
  private executionStats: Map<string, BotExecutionResult[]> = new Map();

  constructor(private options: SandboxOptions = {}) {
    super();
    this.options = { ...this.defaultOptions, ...options };
  }

  /**
   * Execute bot code in a secure sandbox
   */
  async executeBot(
    botId: string,
    botCode: string,
    marketData: MarketData,
    portfolio: any
  ): Promise<BotExecutionResult> {
    const startTime = Date.now();
    const startMemory = process.memoryUsage().heapUsed;

    // Validate bot code before execution
    const validationError = this.validateBotCode(botCode);
    if (validationError) {
      return {
        success: false,
        error: validationError,
        executionTime: Date.now() - startTime,
        memoryUsed: 0
      };
    }

    try {
      // Create a new worker thread with resource limits
      const worker = new Worker(
        path.join(__dirname, 'bot-worker.js'),
        {
          workerData: {
            botCode,
            marketData,
            portfolio
          },
          resourceLimits: {
            maxOldGenerationSizeMb: this.options.maxMemory!,
            maxYoungGenerationSizeMb: Math.floor(this.options.maxMemory! / 4),
            codeRangeSizeMb: 10
          }
        }
      );

      // Store active worker
      this.activeWorkers.set(botId, worker);

      // Execute with timeout
      const result = await this.executeWithTimeout(
        worker,
        this.options.maxExecutionTime!
      );

      // Calculate execution metrics
      const executionTime = Date.now() - startTime;
      const memoryUsed = (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024;

      // Store execution stats
      this.recordExecutionStats(botId, {
        success: true,
        trade: result,
        executionTime,
        memoryUsed
      });

      // Emit execution event
      this.emit('botExecuted', {
        botId,
        success: true,
        executionTime,
        memoryUsed
      });

      return {
        success: true,
        trade: result,
        executionTime,
        memoryUsed
      };

    } catch (error: any) {
      const executionTime = Date.now() - startTime;

      // Record failed execution
      this.recordExecutionStats(botId, {
        success: false,
        error: error.message,
        executionTime,
        memoryUsed: 0
      });

      // Emit error event
      this.emit('botError', {
        botId,
        error: error.message,
        executionTime
      });

      return {
        success: false,
        error: this.sanitizeError(error.message),
        executionTime,
        memoryUsed: 0
      };

    } finally {
      // Clean up worker
      this.cleanupWorker(botId);
    }
  }

  /**
   * Validate bot code for dangerous patterns
   */
  private validateBotCode(code: string): string | null {
    const dangerousPatterns = [
      { pattern: /eval\s*\(/gi, message: 'eval() is not allowed' },
      { pattern: /Function\s*\(/gi, message: 'Function constructor is not allowed' },
      { pattern: /require\s*\(/gi, message: 'require() is not allowed' },
      { pattern: /import\s+/gi, message: 'import statements are not allowed' },
      { pattern: /process\./gi, message: 'process object is not allowed' },
      { pattern: /child_process/gi, message: 'child_process is not allowed' },
      { pattern: /fs\./gi, message: 'file system access is not allowed' },
      { pattern: /net\./gi, message: 'network access is not allowed' },
      { pattern: /http\./gi, message: 'HTTP requests are not allowed' },
      { pattern: /__proto__/gi, message: 'prototype pollution attempt detected' },
      { pattern: /constructor\s*\[/gi, message: 'constructor access is restricted' },
      { pattern: /globalThis/gi, message: 'globalThis is not allowed' },
      { pattern: /window\./gi, message: 'window object is not allowed' },
      { pattern: /document\./gi, message: 'document object is not allowed' },
      { pattern: /setTimeout/gi, message: 'setTimeout is not allowed' },
      { pattern: /setInterval/gi, message: 'setInterval is not allowed' },
      { pattern: /setImmediate/gi, message: 'setImmediate is not allowed' }
    ];

    for (const { pattern, message } of dangerousPatterns) {
      if (pattern.test(code)) {
        return `Security violation: ${message}`;
      }
    }

    // Check code length
    if (code.length > 10000) {
      return 'Bot code exceeds maximum length of 10,000 characters';
    }

    // Check for infinite loops (basic heuristic)
    const loopCount = (code.match(/while\s*\(|for\s*\(/gi) || []).length;
    if (loopCount > 10) {
      return 'Bot code contains too many loops (max 10)';
    }

    return null;
  }

  /**
   * Execute worker with timeout
   */
  private executeWithTimeout(
    worker: Worker,
    timeout: number
  ): Promise<Trade> {
    return new Promise((resolve, reject) => {
      let timeoutId: NodeJS.Timeout;

      // Set execution timeout
      timeoutId = setTimeout(() => {
        worker.terminate();
        reject(new Error(`Bot execution timeout (${timeout}ms exceeded)`));
      }, timeout);

      // Handle worker messages
      worker.on('message', (result) => {
        clearTimeout(timeoutId);
        resolve(result);
      });

      // Handle worker errors
      worker.on('error', (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });

      // Handle worker exit
      worker.on('exit', (code) => {
        clearTimeout(timeoutId);
        if (code !== 0) {
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });
    });
  }

  /**
   * Clean up worker thread
   */
  private cleanupWorker(botId: string): void {
    const worker = this.activeWorkers.get(botId);
    if (worker) {
      worker.terminate();
      this.activeWorkers.delete(botId);
    }
  }

  /**
   * Sanitize error messages to prevent information leakage
   */
  private sanitizeError(error: string): string {
    // Remove file paths and stack traces
    const sanitized = error
      .replace(/\/[^\s]+/g, '[path]')
      .replace(/at\s+.+/g, '')
      .replace(/:\d+:\d+/g, '')
      .trim();

    // Provide user-friendly error messages
    const errorMappings: Record<string, string> = {
      'timeout': 'Bot execution timed out. Please optimize your code.',
      'memory': 'Bot exceeded memory limit. Please reduce memory usage.',
      'syntax': 'Bot code contains syntax errors. Please check your code.',
      'reference': 'Bot code references undefined variables or functions.',
      'type': 'Bot code has type errors. Please check data types.'
    };

    for (const [key, message] of Object.entries(errorMappings)) {
      if (sanitized.toLowerCase().includes(key)) {
        return message;
      }
    }

    return 'Bot execution failed. Please check your code for errors.';
  }

  /**
   * Record execution statistics for monitoring
   */
  private recordExecutionStats(botId: string, result: BotExecutionResult): void {
    if (!this.executionStats.has(botId)) {
      this.executionStats.set(botId, []);
    }

    const stats = this.executionStats.get(botId)!;
    stats.push(result);

    // Keep only last 100 executions
    if (stats.length > 100) {
      stats.shift();
    }
  }

  /**
   * Get execution statistics for a bot
   */
  getStats(botId: string): {
    totalExecutions: number;
    successRate: number;
    averageExecutionTime: number;
    averageMemoryUsed: number;
    lastError?: string;
  } | null {
    const stats = this.executionStats.get(botId);
    if (!stats || stats.length === 0) {
      return null;
    }

    const successful = stats.filter(s => s.success);
    const totalExecutions = stats.length;
    const successRate = successful.length / totalExecutions;
    const averageExecutionTime = stats.reduce((sum, s) => sum + s.executionTime, 0) / totalExecutions;
    const averageMemoryUsed = successful.reduce((sum, s) => sum + s.memoryUsed, 0) / Math.max(successful.length, 1);
    const lastError = stats.filter(s => !s.success).pop()?.error;

    return {
      totalExecutions,
      successRate,
      averageExecutionTime,
      averageMemoryUsed,
      lastError
    };
  }

  /**
   * Terminate all active workers
   */
  async shutdown(): Promise<void> {
    for (const [botId, worker] of this.activeWorkers) {
      await worker.terminate();
    }
    this.activeWorkers.clear();
    this.executionStats.clear();
  }

  /**
   * Get list of active workers
   */
  getActiveWorkers(): string[] {
    return Array.from(this.activeWorkers.keys());
  }

  /**
   * Kill a specific worker
   */
  killWorker(botId: string): boolean {
    const worker = this.activeWorkers.get(botId);
    if (worker) {
      worker.terminate();
      this.activeWorkers.delete(botId);
      return true;
    }
    return false;
  }
}