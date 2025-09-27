# Security Issues Templates for GitHub

Due to GitHub API token limitations, please manually create these 8 critical security issues in the repository:

https://github.com/M0nkeyFl0wer/A-Trading-Game-WTF/issues/new

---

## Issue 1: API Key Exposed in Git History

**Title:** `🚨 CRITICAL SECURITY: API Key Exposed in Git History`

**Labels:** `bug`

**Body:**
```markdown
## 🔴 CRITICAL Security Vulnerability: Exposed API Key

### Severity: CRITICAL
**Priority**: P0 - Drop everything and fix immediately
**Security Risk**: API credential exposure

### Description
ElevenLabs API key has been exposed in Git commits and documentation files. This poses a critical security risk as the key can be accessed by anyone with repository access or through Git history.

### Impact
- ⚠️ Unauthorized access to ElevenLabs API
- 💰 Potential service abuse and unexpected charges
- 🔓 Compromise of voice synthesis capabilities
- 📊 Data exposure through API misuse

### Immediate Actions Required

#### 1. Rotate the exposed API key immediately
- Generate new API key in ElevenLabs dashboard
- Update all systems using the old key

#### 2. Remove key from Git history
```bash
# Use BFG Repo-Cleaner or git filter-branch
git filter-branch --force --index-filter \
  'git rm --cached --ignore-unmatch path/to/file/with/key' \
  --prune-empty --tag-name-filter cat -- --all

# Force push cleaned history (coordinate with team)
git push origin --force --all
```

#### 3. Implement secure key management
```bash
# Store API keys in environment variables only
echo "ELEVENLABS_API_KEY=your_new_key_here" > .env
echo ".env" >> .gitignore
```

### Verification Checklist
- [ ] Old API key has been rotated
- [ ] Key removed from all Git history
- [ ] Environment variables configured
- [ ] Documentation updated with security practices
- [ ] Team educated on secure practices

### Security Best Practices Going Forward
- Never commit API keys, passwords, or secrets to version control
- Use environment variables for sensitive configuration
- Implement key rotation policies
- Monitor API usage for unusual activity
- Use least-privilege access principles

**Estimated Fix Time**: 2-4 hours
**Related**: Part of comprehensive security audit - see SECURITY_AUDIT_PREBETA.md
```

---

## Issue 2: No Input Validation - XSS/Injection Vulnerability

**Title:** `🚨 CRITICAL SECURITY: No Input Validation - XSS/Injection Risk`

**Labels:** `bug`

**Body:**
```markdown
## 🔴 CRITICAL Security Vulnerability: Missing Input Validation

### Severity: CRITICAL
**Priority**: P0 - Cross-site scripting and injection attacks possible
**Security Risk**: XSS, SQL injection, and malicious input execution

### Description
The application lacks comprehensive input validation and sanitization across all user inputs. This creates multiple attack vectors for malicious users to inject scripts, SQL commands, or other dangerous payloads.

### Affected Areas
- All form inputs (login, registration, game actions)
- URL parameters and query strings
- WebSocket message handling
- API endpoints
- User-generated content (usernames, chat messages)

### Attack Vectors
- **XSS**: Malicious JavaScript execution in user browsers
- **SQL Injection**: Database manipulation and data theft
- **Command Injection**: Server-side code execution
- **NoSQL Injection**: Firebase/MongoDB query manipulation
- **Path Traversal**: Unauthorized file access

### Impact
- 🚨 Complete user account compromise
- 💾 Database theft and manipulation
- 🎯 Malware distribution to other users
- 🔒 Session hijacking and impersonation
- 💻 Server compromise

### Immediate Actions Required

#### 1. Install security packages
```bash
npm install dompurify joi helmet express-rate-limit
npm install --dev @types/dompurify
```

#### 2. Implement input sanitization
```typescript
// Install and configure DOMPurify
import DOMPurify from 'dompurify';

// Sanitize all user inputs
const sanitizeInput = (input: string): string => {
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: []
  });
};
```

#### 3. Add validation schemas
```typescript
// Use Joi for comprehensive validation
import Joi from 'joi';

const userSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(30).required(),
  email: Joi.string().email().required(),
  // ... other fields
});
```

#### 4. Implement CSP headers
```typescript
// Add to Express app
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"]
    }
  }
}));
```

### Files to Update
- `apps/web/src/lib/firebase.ts` - Add input validation
- `apps/web/src/components/` - Sanitize all form inputs
- `api/` - Add validation middleware
- `packages/core/` - Validate game actions

### Verification Checklist
- [ ] DOMPurify installed and configured
- [ ] All user inputs sanitized
- [ ] Joi validation schemas implemented
- [ ] CSP headers configured
- [ ] XSS testing completed
- [ ] Penetration testing performed

**Estimated Fix Time**: 1-2 days
**Related**: See SECURITY_AUDIT_PREBETA.md for complete vulnerability list
```

---

## Issue 3: Firebase Security Rules Missing

**Title:** `🚨 CRITICAL SECURITY: Firebase Database Completely Open`

**Labels:** `bug`

**Body:**
```markdown
## 🔴 CRITICAL Security Vulnerability: Missing Firebase Security Rules

### Severity: CRITICAL
**Priority**: P0 - Database is completely exposed to public read/write
**Security Risk**: Unauthorized data access and manipulation

### Description
Firebase Realtime Database has no security rules implemented, allowing anyone with the database URL to read, write, and delete all data. This is equivalent to having a completely open database with no authentication or authorization.

### Current State
```javascript
// Current rules (DANGEROUS!)
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

### Impact
- 🔓 Anyone can read all user data
- ✏️ Anyone can modify or delete game data
- 👤 User accounts can be compromised
- 💰 Game economics can be manipulated
- 🎮 Game integrity completely compromised

### Immediate Actions Required

#### 1. Implement authentication-based rules
```javascript
{
  "rules": {
    "users": {
      "$uid": {
        ".read": "$uid === auth.uid",
        ".write": "$uid === auth.uid && auth != null"
      }
    },
    "games": {
      "$gameId": {
        ".read": "auth != null && (root.child('games').child($gameId).child('players').child(auth.uid).exists() || root.child('games').child($gameId).child('spectators').child(auth.uid).exists())",
        ".write": "auth != null && root.child('games').child($gameId).child('players').child(auth.uid).exists()"
      }
    },
    "leaderboards": {
      ".read": "auth != null",
      ".write": false
    }
  }
}
```

#### 2. Test rules with Firebase simulator
```bash
# Install Firebase tools
npm install -g firebase-tools

# Test rules locally
firebase emulators:start --only database

# Test different user scenarios
firebase database:test-rules
```

#### 3. Deploy rules gradually
```bash
# Deploy to development first
firebase use development
firebase deploy --only database

# Test thoroughly, then deploy to production
firebase use production
firebase deploy --only database
```

### Security Rules Best Practices
- **Principle of least privilege**: Only grant minimum necessary access
- **Authentication required**: Never allow unauthenticated access
- **Validate data structure**: Ensure data integrity
- **Rate limiting**: Prevent abuse
- **Audit trails**: Log access patterns

### Files to Create/Update
- `firebase-database-rules.json` - Security rules
- `apps/web/src/lib/firebase.ts` - Update initialization
- Tests for rules validation

### Verification Checklist
- [ ] Security rules implemented
- [ ] Rules tested with simulator
- [ ] Authentication enforced
- [ ] Data validation rules added
- [ ] Rules deployed to production
- [ ] Access patterns monitored

**Estimated Fix Time**: 4-6 hours
**Related**: Critical security issue - see SECURITY_AUDIT_PREBETA.md
```

---

## Issue 4: Bot Execution Sandbox Missing

**Title:** `🚨 CRITICAL SECURITY: Bot System Allows Arbitrary Code Execution`

**Labels:** `bug`

**Body:**
```markdown
## 🔴 CRITICAL Security Vulnerability: Insecure Bot Execution

### Severity: CRITICAL
**Priority**: P0 - Arbitrary code execution vulnerability
**Security Risk**: Complete server compromise possible

### Description
The AI trading bot system executes user-provided code without proper sandboxing or isolation. This allows malicious users to execute arbitrary code on the server, potentially leading to complete system compromise.

### Current Vulnerability
```typescript
// DANGEROUS: Direct code execution
const executeStrategy = (userCode: string) => {
  return eval(userCode); // NEVER DO THIS!
};
```

### Attack Scenarios
- **Server Takeover**: Full system access via code injection
- **Data Exfiltration**: Access to all server data and secrets
- **Crypto Theft**: Access to wallet private keys
- **DDoS Launch**: Use server as attack platform
- **Malware Installation**: Persistent backdoors

### Impact
- 💥 Complete server compromise
- 🔐 All secrets and API keys stolen
- 💰 Financial losses and liability
- 🎯 Attack on other users
- 📊 All data stolen or destroyed

### Immediate Actions Required

#### 1. Install secure execution environment
```bash
npm install vm2 isolated-vm worker_threads
```

#### 2. Implement VM2 sandbox
```typescript
import { VM } from 'vm2';

const executeStrategySecurely = (userCode: string, context: any) => {
  const vm = new VM({
    timeout: 1000, // 1 second max
    sandbox: {
      // Only provide safe, limited context
      marketData: context.marketData,
      portfolio: context.portfolio,
      // NO access to require, process, etc.
    }
  });

  return vm.run(userCode);
};
```

#### 3. Use Worker Threads for isolation
```typescript
import { Worker, isMainThread, parentPort } from 'worker_threads';

if (!isMainThread) {
  // Worker thread code
  parentPort?.on('message', (userCode) => {
    try {
      // Execute in isolated environment
      const result = safeExecute(userCode);
      parentPort?.postMessage({ success: true, result });
    } catch (error) {
      parentPort?.postMessage({ success: false, error: error.message });
    }
  });
}
```

#### 4. Implement strict validation
```typescript
const validateBotCode = (code: string): boolean => {
  // Check for dangerous patterns
  const dangerousPatterns = [
    /require\s*\(/,
    /import\s+/,
    /process\./,
    /global\./,
    /eval\s*\(/,
    /Function\s*\(/,
    /constructor/,
    /__proto__/
  ];

  return !dangerousPatterns.some(pattern => pattern.test(code));
};
```

### Files to Update
- `packages/bot/src/strategies/` - All strategy execution
- `apps/web/src/lib/bot-runner.ts` - Bot execution engine
- `api/bot-execution.ts` - API endpoint security

### Verification Checklist
- [ ] VM2 or isolated-vm implemented
- [ ] Worker threads for isolation
- [ ] Code validation implemented
- [ ] Timeout limits enforced
- [ ] Resource limits set
- [ ] Security testing completed
- [ ] Penetration testing performed

**Estimated Fix Time**: 2-3 days
**Critical**: This issue could lead to complete system compromise
```

---

## Issue 5: No Rate Limiting - DDoS Vulnerability

**Title:** `🔥 HIGH SECURITY: No Rate Limiting - DDoS and Abuse Vulnerability`

**Labels:** `bug, enhancement`

**Body:**
```markdown
## 🟠 HIGH Security Vulnerability: Missing Rate Limiting

### Severity: HIGH
**Priority**: P1 - API endpoints vulnerable to abuse and DDoS attacks
**Security Risk**: Service availability and resource exhaustion

### Description
All API endpoints lack rate limiting, making the application vulnerable to denial-of-service attacks, resource exhaustion, and API abuse. Attackers can overwhelm the server with requests, causing service degradation or complete unavailability.

### Vulnerable Endpoints
- Authentication endpoints (login/register flooding)
- Game action endpoints (rapid-fire trading)
- Voice synthesis API calls (expensive resource abuse)
- Database read/write operations
- WebSocket connections

### Attack Scenarios
- **DDoS**: Overwhelming server with requests
- **Brute Force**: Password/API key attacks
- **Resource Exhaustion**: Expensive API call abuse
- **Economic Attacks**: Running up third-party API costs
- **Service Degradation**: Legitimate users locked out

### Impact
- 🚫 Service unavailability for legitimate users
- 💰 Unexpected API costs (ElevenLabs, Firebase)
- 📊 Database performance degradation
- 🎯 Reputation damage
- 💻 Server resource exhaustion

### Immediate Actions Required

#### 1. Install rate limiting packages
```bash
npm install express-rate-limit redis express-slow-down
```

#### 2. Implement basic rate limiting
```typescript
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import Redis from 'redis';

const redisClient = Redis.createClient();

// General API rate limit
const apiLimiter = rateLimit({
  store: new RedisStore({
    client: redisClient,
  }),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests, please try again later.',
});

// Strict rate limit for expensive operations
const expensiveLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // Only 5 requests per minute for expensive ops
  message: 'Rate limit exceeded for this operation.',
});
```

#### 3. Apply to specific endpoints
```typescript
// Apply to Express app
app.use('/api/', apiLimiter);
app.use('/api/voice/', expensiveLimiter);
app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // 5 login attempts per 15 minutes
}));
```

#### 4. Implement WebSocket rate limiting
```typescript
// WebSocket rate limiting
const wsRateLimiter = new Map();

io.on('connection', (socket) => {
  const clientId = socket.handshake.address;

  socket.on('game-action', (data) => {
    if (isRateLimited(clientId, 'game-action', 10, 60000)) {
      socket.emit('error', 'Rate limit exceeded');
      return;
    }
    // Process action
  });
});
```

### Rate Limiting Strategy
- **Authentication**: 5 attempts per 15 minutes
- **API Calls**: 100 requests per 15 minutes
- **Voice Generation**: 5 requests per minute
- **Game Actions**: 10 actions per minute
- **WebSocket**: 50 messages per minute

### Files to Update
- `api/middleware/rateLimiter.ts` - Rate limiting middleware
- `apps/web/src/lib/api.ts` - Client-side rate limit handling
- `api/auth.ts` - Authentication rate limits
- `api/voice.ts` - Voice API rate limits

### Verification Checklist
- [ ] express-rate-limit installed and configured
- [ ] Redis store for distributed rate limiting
- [ ] Different limits for different endpoint types
- [ ] WebSocket rate limiting implemented
- [ ] Rate limit headers returned to clients
- [ ] Graceful degradation for rate-limited requests
- [ ] Monitoring and alerting for rate limit violations

**Estimated Fix Time**: 1-2 days
**Related**: Part of comprehensive security hardening
```

---

## Issue 6: CORS Too Permissive - Cross-Origin Attack Risk

**Title:** `🔥 HIGH SECURITY: CORS Configuration Too Permissive`

**Labels:** `bug`

**Body:**
```markdown
## 🟠 HIGH Security Vulnerability: Overly Permissive CORS

### Severity: HIGH
**Priority**: P1 - Cross-origin attacks possible
**Security Risk**: Cross-site request forgery and data theft

### Description
The application's CORS (Cross-Origin Resource Sharing) configuration is too permissive, allowing requests from any origin. This enables attackers to make unauthorized requests from malicious websites to your API endpoints.

### Current Configuration (Dangerous)
```javascript
// DANGEROUS: Allows all origins
app.use(cors({
  origin: '*',  // This allows ANY website to make requests
  credentials: true
}));
```

### Attack Scenarios
- **CSRF**: Malicious sites making authenticated requests
- **Data Theft**: Stealing user data via cross-origin requests
- **Session Hijacking**: Unauthorized access using user cookies
- **API Abuse**: External sites consuming your API resources

### Impact
- 🎯 User accounts compromised via malicious websites
- 📊 Unauthorized data access and theft
- 💰 API resource abuse and unexpected costs
- 🔒 Session security completely bypassed

### Immediate Actions Required

#### 1. Restrict CORS origins to specific domains
```typescript
import cors from 'cors';

const corsOptions = {
  origin: [
    'http://localhost:3000',
    'http://localhost:3001',
    'https://a-trading-game-wtf.vercel.app',
    'https://your-production-domain.com'
  ],
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

app.use(cors(corsOptions));
```

#### 2. Implement dynamic origin validation
```typescript
const dynamicCors = cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, etc.)
    if (!origin) return callback(null, true);

    const allowedOrigins = [
      /^https:\/\/.*\.vercel\.app$/,
      /^https:\/\/your-domain\.com$/,
      /^http:\/\/localhost:\d+$/
    ];

    const isAllowed = allowedOrigins.some(pattern =>
      typeof pattern === 'string' ? pattern === origin : pattern.test(origin)
    );

    callback(isAllowed ? null : new Error('Not allowed by CORS'), isAllowed);
  },
  credentials: true
});
```

#### 3. Implement CSRF protection
```bash
npm install csurf
```

```typescript
import csrf from 'csurf';

// CSRF protection middleware
const csrfProtection = csrf({
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict'
  }
});

app.use(csrfProtection);
```

#### 4. Add security headers
```typescript
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", "https://api.elevenlabs.io", "wss://your-websocket-domain.com"]
    }
  }
}));
```

### Environment-Specific Configuration
```typescript
const getAllowedOrigins = () => {
  if (process.env.NODE_ENV === 'production') {
    return [
      'https://a-trading-game-wtf.vercel.app',
      'https://your-production-domain.com'
    ];
  }

  return [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173' // Vite dev server
  ];
};
```

### Files to Update
- `api/middleware/cors.ts` - CORS configuration
- `apps/web/vite.config.ts` - Development proxy settings
- `vercel.json` - Production CORS headers
- `apps/web/src/lib/api.ts` - Client-side request configuration

### Verification Checklist
- [ ] CORS origins restricted to specific domains
- [ ] Development and production configurations separated
- [ ] CSRF protection implemented
- [ ] Security headers configured
- [ ] Cross-origin requests tested and working
- [ ] Unauthorized origins properly blocked
- [ ] CORS preflight requests handled correctly

**Estimated Fix Time**: 4-6 hours
**Related**: Critical for preventing cross-origin attacks
```

---

## Issue 7: No Content Security Policy - XSS Vulnerability

**Title:** `🔥 HIGH SECURITY: Missing Content Security Policy Headers`

**Labels:** `enhancement`

**Body:**
```markdown
## 🟠 HIGH Security Vulnerability: Missing Content Security Policy

### Severity: HIGH
**Priority**: P1 - XSS attacks not properly mitigated
**Security Risk**: Cross-site scripting and malicious content injection

### Description
The application lacks Content Security Policy (CSP) headers, which are crucial for preventing cross-site scripting (XSS) attacks. Without CSP, malicious scripts can be executed in user browsers, leading to account compromise and data theft.

### Missing Protection
- No script source restrictions
- No style source limitations
- No image source controls
- No connection restrictions
- No frame protection

### Attack Scenarios
- **XSS**: Malicious JavaScript execution in user browsers
- **Clickjacking**: Embedding app in malicious iframes
- **Data Exfiltration**: Stealing user data via injected scripts
- **Malware Distribution**: Loading malicious resources
- **Session Hijacking**: Stealing authentication tokens

### Impact
- 🚨 Complete user account compromise
- 🔓 Session token theft and impersonation
- 📊 User data theft and privacy violations
- 🎯 Malware distribution to users
- 💻 Browser exploitation

### Immediate Actions Required

#### 1. Install helmet for security headers
```bash
npm install helmet
```

#### 2. Implement comprehensive CSP
```typescript
import helmet from 'helmet';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],

      // Scripts
      scriptSrc: [
        "'self'",
        "'unsafe-inline'", // Minimize this - only for critical inline scripts
        "https://cdnjs.cloudflare.com",
        "https://cdn.jsdelivr.net"
      ],

      // Styles
      styleSrc: [
        "'self'",
        "'unsafe-inline'", // For CSS-in-JS libraries
        "https://fonts.googleapis.com"
      ],

      // Images
      imgSrc: [
        "'self'",
        "data:",
        "https:",
        "blob:"
      ],

      // Fonts
      fontSrc: [
        "'self'",
        "https://fonts.gstatic.com"
      ],

      // Connections (API calls, WebSockets)
      connectSrc: [
        "'self'",
        "https://api.elevenlabs.io",
        "wss://your-websocket-domain.com",
        "https://*.firebase.googleapis.com",
        "wss://*.firebaseio.com"
      ],

      // Media
      mediaSrc: ["'self'", "blob:", "data:"],

      // Objects and embeds
      objectSrc: ["'none'"],

      // Frames
      frameSrc: ["'none'"],
      frameAncestors: ["'none'"],

      // Base URI
      baseUri: ["'self'"],

      // Forms
      formAction: ["'self'"]
    },
    reportOnly: false // Set to true initially for testing
  },

  // Additional security headers
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },

  // Prevent MIME type sniffing
  noSniff: true,

  // Prevent clickjacking
  frameguard: { action: 'deny' },

  // HTTPS enforcement
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));
```

#### 3. Handle CSP for development vs production
```typescript
const getCspDirectives = () => {
  const baseDirectives = {
    defaultSrc: ["'self'"],
    imgSrc: ["'self'", "data:", "https:", "blob:"],
    fontSrc: ["'self'", "https://fonts.gstatic.com"],
    connectSrc: [
      "'self'",
      "https://api.elevenlabs.io",
      "https://*.firebase.googleapis.com",
      "wss://*.firebaseio.com"
    ]
  };

  if (process.env.NODE_ENV === 'development') {
    return {
      ...baseDirectives,
      scriptSrc: ["'self'", "'unsafe-eval'", "'unsafe-inline'"], // For hot reload
      styleSrc: ["'self'", "'unsafe-inline'"], // For dev styles
      connectSrc: [...baseDirectives.connectSrc, "ws://localhost:*", "http://localhost:*"]
    };
  }

  return {
    ...baseDirectives,
    scriptSrc: ["'self'", "'unsafe-inline'"], // Minimize unsafe-inline in production
    styleSrc: ["'self'", "'unsafe-inline'"]
  };
};
```

#### 4. Implement CSP reporting
```typescript
// CSP violation reporting endpoint
app.post('/csp-report', express.json({ type: 'application/csp-report' }), (req, res) => {
  console.log('CSP Violation:', req.body);
  // Log to monitoring service
  res.status(204).send();
});

// Add report URI to CSP
const cspDirectives = {
  ...getCspDirectives(),
  reportUri: ['/csp-report']
};
```

### Files to Update
- `api/middleware/security.ts` - CSP configuration
- `apps/web/vite.config.ts` - Development CSP handling
- `vercel.json` - Production CSP headers
- `apps/web/index.html` - Meta CSP tags as fallback

### Gradual Implementation Strategy
1. **Phase 1**: Implement in report-only mode
2. **Phase 2**: Analyze violation reports
3. **Phase 3**: Refine policy based on legitimate violations
4. **Phase 4**: Enable enforcement mode
5. **Phase 5**: Minimize 'unsafe-inline' and 'unsafe-eval'

### Verification Checklist
- [ ] Helmet installed and configured
- [ ] CSP directives implemented
- [ ] Development vs production configurations
- [ ] CSP reporting endpoint created
- [ ] Policy tested in report-only mode
- [ ] Legitimate violations identified and fixed
- [ ] Enforcement mode enabled
- [ ] CSP headers verified in browser dev tools

**Estimated Fix Time**: 6-8 hours
**Related**: Critical XSS protection - see SECURITY_AUDIT_PREBETA.md
```

---

## Issue 8: Smart Contract Reentrancy Vulnerability

**Title:** `🔥 HIGH SECURITY: Smart Contract Reentrancy in Prize Distribution`

**Labels:** `bug`

**Body:**
```markdown
## 🟠 HIGH Security Vulnerability: Smart Contract Reentrancy

### Severity: HIGH
**Priority**: P1 - Prize distribution vulnerable to reentrancy attacks
**Security Risk**: Funds theft and contract exploitation

### Description
The prize distribution smart contract is vulnerable to reentrancy attacks, where malicious contracts can repeatedly call the withdrawal function before the state is updated, potentially draining the entire prize pool.

### Vulnerable Code Pattern
```solidity
// VULNERABLE: External call before state update
function claimPrize() external {
    uint256 prize = prizes[msg.sender];
    require(prize > 0, "No prize to claim");

    // DANGEROUS: External call before state update
    (bool success, ) = msg.sender.call{value: prize}("");
    require(success, "Transfer failed");

    // State update AFTER external call - TOO LATE!
    prizes[msg.sender] = 0;
}
```

### Attack Scenario
```solidity
// Malicious contract
contract Attacker {
    TradingGame target;

    function attack() external {
        target.claimPrize(); // Start the attack
    }

    // Reentrancy attack via fallback function
    receive() external payable {
        if (address(target).balance > 0) {
            target.claimPrize(); // Re-enter before state update!
        }
    }
}
```

### Impact
- 💰 Complete prize pool drainage
- 🎯 Legitimate winners lose their prizes
- 📉 Token/ETH theft from contract
- 🔒 Contract becomes unusable
- 💸 Massive financial losses

### Immediate Actions Required

#### 1. Install OpenZeppelin security contracts
```bash
npm install @openzeppelin/contracts
```

#### 2. Implement ReentrancyGuard
```solidity
// SECURE: Using OpenZeppelin ReentrancyGuard
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract TradingGame is ReentrancyGuard {
    mapping(address => uint256) public prizes;

    // nonReentrant modifier prevents reentrancy
    function claimPrize() external nonReentrant {
        uint256 prize = prizes[msg.sender];
        require(prize > 0, "No prize to claim");

        // State update BEFORE external call
        prizes[msg.sender] = 0;

        // External call after state update
        (bool success, ) = msg.sender.call{value: prize}("");
        require(success, "Transfer failed");
    }
}
```

#### 3. Implement pull payment pattern
```solidity
// EVEN BETTER: Pull payment pattern
import "@openzeppelin/contracts/security/PullPayment.sol";

contract TradingGame is PullPayment {
    mapping(address => uint256) public prizes;

    function distributePrize(address winner, uint256 amount) internal {
        prizes[winner] += amount;
        // Use OpenZeppelin's pull payment system
        _asyncTransfer(winner, amount);
    }

    // Users call this to withdraw their prizes
    function withdrawPrize() external {
        uint256 prize = prizes[msg.sender];
        require(prize > 0, "No prize to claim");

        prizes[msg.sender] = 0;
        withdrawPayments(payable(msg.sender));
    }
}
```

#### 4. Add comprehensive access controls
```solidity
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

contract TradingGame is ReentrancyGuard, Ownable, Pausable {
    // Emergency pause mechanism
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // All critical functions use whenNotPaused
    function claimPrize() external nonReentrant whenNotPaused {
        // ... secure implementation
    }
}
```

### Additional Security Measures

#### 1. Checks-Effects-Interactions Pattern
```solidity
function claimPrize() external nonReentrant {
    // 1. CHECKS: Validate conditions
    uint256 prize = prizes[msg.sender];
    require(prize > 0, "No prize to claim");
    require(address(this).balance >= prize, "Insufficient contract balance");

    // 2. EFFECTS: Update state
    prizes[msg.sender] = 0;
    totalPrizes -= prize;

    // 3. INTERACTIONS: External calls last
    (bool success, ) = msg.sender.call{value: prize}("");
    require(success, "Transfer failed");

    emit PrizeClaimed(msg.sender, prize);
}
```

#### 2. Circuit breakers and limits
```solidity
uint256 public constant MAX_WITHDRAWAL_PER_BLOCK = 10 ether;
mapping(uint256 => uint256) public blockWithdrawals;

modifier withdrawalLimit(uint256 amount) {
    require(
        blockWithdrawals[block.number] + amount <= MAX_WITHDRAWAL_PER_BLOCK,
        "Block withdrawal limit exceeded"
    );
    blockWithdrawals[block.number] += amount;
    _;
}
```

### Files to Update
- `packages/contract/src/TradingGame.sol` - Main contract security
- `packages/contract/src/PrizeDistribution.sol` - Prize logic
- `packages/contract/test/` - Comprehensive security tests
- `packages/contract/scripts/deploy.ts` - Secure deployment

### Testing Requirements
```javascript
// Security test examples
describe("Reentrancy Protection", () => {
  it("should prevent reentrancy attacks", async () => {
    // Deploy malicious contract
    const attacker = await deployAttacker();

    // Attempt reentrancy attack
    await expect(attacker.attack()).to.be.revertedWith("ReentrancyGuard: reentrant call");
  });

  it("should follow CEI pattern", async () => {
    // Test that state is updated before external calls
  });
});
```

### Verification Checklist
- [ ] ReentrancyGuard implemented on all vulnerable functions
- [ ] Checks-Effects-Interactions pattern followed
- [ ] Pull payment pattern implemented
- [ ] Emergency pause mechanism added
- [ ] Comprehensive security tests written
- [ ] External security audit completed
- [ ] Gas limit testing performed
- [ ] Circuit breakers implemented

**Estimated Fix Time**: 3-4 days
**Critical**: Must be fixed before any mainnet deployment
```

---

## Manual Creation Instructions

1. **Go to GitHub Issues**: https://github.com/M0nkeyFl0wer/A-Trading-Game-WTF/issues/new

2. **Create each issue by**:
   - Copy the **Title** exactly as shown
   - Add the specified **Labels**
   - Copy the entire **Body** content (everything in the markdown code block)

3. **Priority Order** (create in this order):
   1. API Key Exposed (CRITICAL - do this first!)
   2. No Input Validation (CRITICAL)
   3. Firebase Security Rules Missing (CRITICAL)
   4. Bot Execution Sandbox Missing (CRITICAL)
   5. No Rate Limiting (HIGH)
   6. CORS Too Permissive (HIGH)
   7. No Content Security Policy (HIGH)
   8. Smart Contract Reentrancy (HIGH)

4. **After creating all issues**:
   - Note down the issue numbers
   - Create a security milestone to track progress
   - Assign priority labels if available
   - Link related issues in comments

## Summary

These 8 security issues represent critical vulnerabilities that must be addressed before any beta launch. The CRITICAL issues should be fixed immediately, while HIGH priority issues should be resolved within the next sprint.

**Total estimated fix time**: 2-3 weeks with dedicated focus
**Recommended approach**: Fix CRITICAL issues first, then systematically address HIGH priority items.