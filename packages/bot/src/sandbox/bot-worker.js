/**
 * Worker thread script for executing bot code in isolation
 * This runs in a separate thread with limited resources
 */

const { parentPort, workerData } = require('worker_threads');
const vm = require('vm');

// Extract data from parent thread
const { botCode, marketData, portfolio } = workerData;

// Create a secure sandbox context
const sandbox = {
  // Provide only necessary data
  market: {
    price: marketData.price,
    volume: marketData.volume,
    trend: marketData.trend,
    volatility: marketData.volatility,
    momentum: marketData.momentum,
    support: marketData.support,
    resistance: marketData.resistance
  },

  portfolio: {
    balance: portfolio.balance,
    positions: portfolio.positions,
    trades: portfolio.trades
  },

  // Provide safe math functions
  Math: {
    abs: Math.abs,
    ceil: Math.ceil,
    floor: Math.floor,
    round: Math.round,
    min: Math.min,
    max: Math.max,
    pow: Math.pow,
    sqrt: Math.sqrt,
    random: Math.random,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    PI: Math.PI,
    E: Math.E
  },

  // Provide safe array methods
  Array: {
    isArray: Array.isArray,
    from: Array.from
  },

  // Provide safe JSON methods
  JSON: {
    parse: JSON.parse,
    stringify: JSON.stringify
  },

  // Console for debugging (limited)
  console: {
    log: (...args) => {
      // Limit console output
      const output = args.slice(0, 3).map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg).slice(0, 100) : String(arg).slice(0, 100)
      ).join(' ');

      // Send debug message to parent (optional)
      // parentPort.postMessage({ type: 'debug', message: output });
    }
  },

  // Result object that bot must populate
  result: {
    action: null, // 'BUY', 'SELL', 'HOLD'
    amount: 0,
    confidence: 0,
    reasoning: ''
  }
};

try {
  // Create VM context
  vm.createContext(sandbox);

  // Wrap bot code in a function to ensure it returns a result
  const wrappedCode = `
    (function() {
      ${botCode}

      // Ensure result is properly formatted
      if (typeof decideTrade === 'function') {
        const decision = decideTrade(market, portfolio);
        result.action = decision.action || 'HOLD';
        result.amount = Number(decision.amount) || 0;
        result.confidence = Number(decision.confidence) || 0;
        result.reasoning = String(decision.reasoning || '');
      }
    })();
  `;

  // Execute bot code with timeout
  const script = new vm.Script(wrappedCode, {
    filename: 'bot.js',
    timeout: 4000 // 4 seconds (leave 1 second buffer for cleanup)
  });

  script.runInContext(sandbox, {
    timeout: 4000,
    breakOnSigint: true
  });

  // Validate result
  const { result } = sandbox;

  if (!result.action || !['BUY', 'SELL', 'HOLD'].includes(result.action)) {
    throw new Error('Invalid trade action. Must be BUY, SELL, or HOLD');
  }

  if (result.action !== 'HOLD') {
    if (typeof result.amount !== 'number' || result.amount <= 0) {
      throw new Error('Invalid trade amount. Must be a positive number');
    }

    if (result.amount > portfolio.balance) {
      throw new Error('Trade amount exceeds available balance');
    }

    if (typeof result.confidence !== 'number' || result.confidence < 0 || result.confidence > 1) {
      throw new Error('Invalid confidence level. Must be between 0 and 1');
    }
  }

  // Send successful result back to parent
  parentPort.postMessage({
    action: result.action,
    amount: Math.min(result.amount, portfolio.balance),
    confidence: Math.max(0, Math.min(1, result.confidence)),
    reasoning: String(result.reasoning).slice(0, 200),
    timestamp: Date.now()
  });

} catch (error) {
  // Send error back to parent
  parentPort.postMessage({
    error: error.message,
    timestamp: Date.now()
  });
}

// Clean exit
process.exit(0);