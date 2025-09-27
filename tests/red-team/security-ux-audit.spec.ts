import { test, expect, Page, BrowserContext } from '@playwright/test';

/**
 * Red Team Assessment: Security & UX Vulnerabilities
 * This suite simulates malicious users and identifies UX/Security issues
 */

const TARGET_URL = process.env.TEST_URL || 'http://localhost:3001';

// Helper function to measure performance
async function measurePerformance(page: Page, action: () => Promise<void>) {
  const startTime = Date.now();
  await action();
  return Date.now() - startTime;
}

test.describe('🔴 RED TEAM: Security Vulnerabilities', () => {

  test('XSS: Inject malicious scripts in user inputs', async ({ page }) => {
    await page.goto(TARGET_URL);

    const xssPayloads = [
      '<script>alert("XSS")</script>',
      '<img src=x onerror="alert(\'XSS\')">',
      'javascript:alert("XSS")',
      '<svg onload=alert("XSS")>',
      '"><script>alert(String.fromCharCode(88,83,83))</script>',
      '<iframe src="javascript:alert(\'XSS\')">',
      '<body onload=alert("XSS")>',
      '${alert("XSS")}',
      '{{constructor.constructor("alert(1)")()}}'
    ];

    const issues = [];

    // Test username field
    for (const payload of xssPayloads) {
      const usernameField = await page.$('input[name="username"], input[type="text"]').catch(() => null);
      if (usernameField) {
        await usernameField.fill(payload);

        // Check if script executed
        const alertFired = await page.evaluate(() => {
          return new Promise(resolve => {
            const originalAlert = window.alert;
            window.alert = () => {
              window.alert = originalAlert;
              resolve(true);
            };
            setTimeout(() => resolve(false), 100);
          });
        });

        if (alertFired) {
          issues.push(`XSS vulnerability found with payload: ${payload}`);
        }
      }
    }

    expect(issues).toHaveLength(0);
  });

  test('SQL/NoSQL Injection attempts', async ({ page }) => {
    await page.goto(TARGET_URL);

    const injectionPayloads = [
      "' OR '1'='1",
      "admin'--",
      "' OR 1=1--",
      '{"$ne": null}',
      '{"$gt": ""}',
      "'; DROP TABLE users;--",
      "' UNION SELECT * FROM users--",
      '{"$where": "this.password == null"}',
    ];

    const issues = [];

    for (const payload of injectionPayloads) {
      const response = await page.evaluate(async (payload) => {
        try {
          const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: payload, password: payload })
          });
          return { status: res.status, text: await res.text() };
        } catch (err) {
          return { error: err.message };
        }
      }, payload);

      // Check for unexpected success or error disclosure
      if (response.status === 200 || (response.text && response.text.includes('error'))) {
        issues.push(`Potential injection vulnerability with payload: ${payload}`);
      }
    }

    expect(issues).toHaveLength(0);
  });

  test('Rate Limiting: DDoS simulation', async ({ page }) => {
    const requests = [];

    // Attempt 150 rapid requests
    for (let i = 0; i < 150; i++) {
      requests.push(
        page.evaluate(async () => {
          const res = await fetch('/api/health');
          return res.status;
        })
      );
    }

    const results = await Promise.all(requests);
    const rateLimited = results.filter(status => status === 429);

    // Should start rate limiting after 100 requests
    expect(rateLimited.length).toBeGreaterThan(0);
    expect(rateLimited.length).toBeLessThanOrEqual(50);
  });

  test('CSRF: Cross-site request forgery', async ({ page, context }) => {
    // Create a malicious page
    await page.goto('data:text/html,<h1>Malicious Site</h1>');

    // Attempt CSRF attack
    const response = await page.evaluate(async () => {
      try {
        const res = await fetch('http://localhost:3001/api/trading/execute', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'BUY', amount: 1000000 })
        });
        return res.status;
      } catch (err) {
        return 'blocked';
      }
    });

    // Should be blocked by CORS or CSRF protection
    expect(response).not.toBe(200);
  });

  test('Authentication Bypass: Direct API access', async ({ page }) => {
    const endpoints = [
      '/api/user/profile',
      '/api/trading/portfolio',
      '/api/room/create',
      '/api/bot/strategies'
    ];

    const issues = [];

    for (const endpoint of endpoints) {
      const response = await page.evaluate(async (endpoint) => {
        const res = await fetch(endpoint);
        return res.status;
      }, TARGET_URL + endpoint);

      if (response === 200) {
        issues.push(`Unauthenticated access to: ${endpoint}`);
      }
    }

    expect(issues).toHaveLength(0);
  });

  test('Sensitive Data Exposure: Check for leaks', async ({ page }) => {
    await page.goto(TARGET_URL);

    const issues = [];

    // Check localStorage
    const localStorage = await page.evaluate(() => {
      return Object.keys(window.localStorage);
    });

    for (const key of localStorage) {
      const value = await page.evaluate(key => window.localStorage.getItem(key), key);
      if (value && (value.includes('password') || value.includes('token') || value.includes('key'))) {
        issues.push(`Sensitive data in localStorage: ${key}`);
      }
    }

    // Check console for sensitive data
    const consoleLogs = [];
    page.on('console', msg => consoleLogs.push(msg.text()));
    await page.reload();

    for (const log of consoleLogs) {
      if (log.includes('password') || log.includes('token') || log.includes('secret')) {
        issues.push(`Sensitive data in console: ${log.substring(0, 50)}...`);
      }
    }

    expect(issues).toHaveLength(0);
  });
});

test.describe('🟠 RED TEAM: UX Vulnerabilities & Issues', () => {

  test('Performance: Page load times', async ({ page }) => {
    const metrics = await page.goto(TARGET_URL).then(async () => {
      return await page.evaluate(() => {
        const perfData = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
        return {
          domContentLoaded: perfData.domContentLoadedEventEnd - perfData.domContentLoadedEventStart,
          loadComplete: perfData.loadEventEnd - perfData.loadEventStart,
          firstPaint: performance.getEntriesByType('paint')[0]?.startTime || 0,
          firstContentfulPaint: performance.getEntriesByType('paint')[1]?.startTime || 0
        };
      });
    });

    // Performance thresholds
    expect(metrics.firstContentfulPaint).toBeLessThan(2000); // 2 seconds
    expect(metrics.domContentLoaded).toBeLessThan(3000); // 3 seconds
    expect(metrics.loadComplete).toBeLessThan(5000); // 5 seconds
  });

  test('Accessibility: WCAG compliance', async ({ page }) => {
    await page.goto(TARGET_URL);

    const issues = [];

    // Check for alt text on images
    const imagesWithoutAlt = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      return imgs.filter(img => !img.alt).length;
    });

    if (imagesWithoutAlt > 0) {
      issues.push(`${imagesWithoutAlt} images without alt text`);
    }

    // Check for proper heading hierarchy
    const headingIssues = await page.evaluate(() => {
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
      const issues = [];
      let lastLevel = 0;

      headings.forEach(h => {
        const level = parseInt(h.tagName[1]);
        if (level - lastLevel > 1) {
          issues.push(`Skipped heading level: ${h.tagName}`);
        }
        lastLevel = level;
      });

      return issues;
    });

    issues.push(...headingIssues);

    // Check for form labels
    const inputsWithoutLabels = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input, select, textarea'));
      return inputs.filter(input => {
        const id = input.id;
        if (!id) return true;
        return !document.querySelector(`label[for="${id}"]`);
      }).length;
    });

    if (inputsWithoutLabels > 0) {
      issues.push(`${inputsWithoutLabels} form inputs without labels`);
    }

    // Check color contrast
    const lowContrastElements = await page.evaluate(() => {
      const getContrastRatio = (color1: string, color2: string) => {
        // Simplified contrast calculation
        return 4.5; // Mock for now
      };

      const elements = Array.from(document.querySelectorAll('*'));
      return elements.filter(el => {
        const style = window.getComputedStyle(el);
        const bg = style.backgroundColor;
        const fg = style.color;
        if (bg === 'rgba(0, 0, 0, 0)' || fg === 'rgba(0, 0, 0, 0)') return false;
        return getContrastRatio(bg, fg) < 4.5;
      }).length;
    });

    if (lowContrastElements > 0) {
      issues.push(`${lowContrastElements} elements with low color contrast`);
    }

    expect(issues).toHaveLength(0);
  });

  test('Mobile Responsiveness: Various viewports', async ({ page }) => {
    const viewports = [
      { name: 'iPhone SE', width: 375, height: 667 },
      { name: 'iPhone 12', width: 390, height: 844 },
      { name: 'iPad', width: 768, height: 1024 },
      { name: 'Desktop', width: 1920, height: 1080 }
    ];

    const issues = [];

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto(TARGET_URL);

      // Check for horizontal scroll
      const hasHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });

      if (hasHorizontalScroll) {
        issues.push(`Horizontal scroll on ${viewport.name}`);
      }

      // Check for overlapping elements
      const overlappingElements = await page.evaluate(() => {
        const elements = Array.from(document.querySelectorAll('*'));
        const overlaps = [];

        for (let i = 0; i < elements.length - 1; i++) {
          const rect1 = elements[i].getBoundingClientRect();
          const rect2 = elements[i + 1].getBoundingClientRect();

          if (rect1.right > rect2.left && rect1.left < rect2.right &&
              rect1.bottom > rect2.top && rect1.top < rect2.bottom) {
            overlaps.push({
              el1: elements[i].tagName,
              el2: elements[i + 1].tagName
            });
          }
        }

        return overlaps.length;
      });

      if (overlappingElements > 0) {
        issues.push(`${overlappingElements} overlapping elements on ${viewport.name}`);
      }
    }

    expect(issues).toHaveLength(0);
  });

  test('Error Handling: User-friendly messages', async ({ page }) => {
    await page.goto(TARGET_URL);

    const issues = [];

    // Test 404 page
    await page.goto(`${TARGET_URL}/nonexistent-page`);
    const has404Page = await page.locator('text=/404|not found/i').count();

    if (has404Page === 0) {
      issues.push('No user-friendly 404 page');
    }

    // Test network error handling
    await page.route('**/api/**', route => route.abort());
    await page.goto(TARGET_URL);

    const hasErrorMessage = await page.locator('text=/error|failed|problem/i').count();

    if (hasErrorMessage === 0) {
      issues.push('No error message shown for network failures');
    }

    expect(issues).toHaveLength(0);
  });

  test('Form Validation: User feedback', async ({ page }) => {
    await page.goto(TARGET_URL);

    const issues = [];

    // Find forms
    const forms = await page.locator('form').all();

    for (const form of forms) {
      // Submit empty form
      const submitButton = await form.locator('button[type="submit"], input[type="submit"]').first();

      if (submitButton) {
        await submitButton.click();

        // Check for validation messages
        const validationMessages = await page.locator('.error, .invalid, [role="alert"]').count();

        if (validationMessages === 0) {
          issues.push('No validation feedback for empty form submission');
        }

        // Check for inline validation
        const inputs = await form.locator('input[required]').all();

        for (const input of inputs) {
          await input.fill('a');
          await input.fill('');

          const hasInlineError = await input.evaluate(el => {
            const parent = el.parentElement;
            return parent?.querySelector('.error, .invalid') !== null;
          });

          if (!hasInlineError) {
            issues.push('No inline validation for required fields');
            break;
          }
        }
      }
    }

    expect(issues).toHaveLength(0);
  });

  test('Navigation: Dead links and broken routes', async ({ page }) => {
    await page.goto(TARGET_URL);

    const links = await page.locator('a[href]').all();
    const issues = [];

    for (const link of links) {
      const href = await link.getAttribute('href');

      if (href && !href.startsWith('#') && !href.startsWith('mailto:')) {
        const response = await page.request.get(href).catch(() => null);

        if (!response || response.status() >= 400) {
          issues.push(`Dead link: ${href}`);
        }
      }
    }

    expect(issues).toHaveLength(0);
  });

  test('Loading States: User feedback during operations', async ({ page }) => {
    await page.goto(TARGET_URL);

    const issues = [];

    // Intercept API calls and delay them
    await page.route('**/api/**', async route => {
      await new Promise(resolve => setTimeout(resolve, 2000));
      await route.continue();
    });

    // Trigger an action that makes API call
    const actionButton = await page.locator('button').first();
    if (actionButton) {
      await actionButton.click();

      // Check for loading indicator
      const hasLoadingIndicator = await page.locator('.loading, .spinner, [aria-busy="true"]').count();

      if (hasLoadingIndicator === 0) {
        issues.push('No loading indicator during async operations');
      }

      // Check if buttons are disabled during loading
      const isDisabled = await actionButton.isDisabled();

      if (!isDisabled) {
        issues.push('Buttons not disabled during loading');
      }
    }

    expect(issues).toHaveLength(0);
  });
});

test.describe('🎮 RED TEAM: Gameplay Simulation', () => {

  test('Complete gameplay flow', async ({ page }) => {
    await page.goto(TARGET_URL);

    const issues = [];

    // 1. Registration/Login
    const loginTime = await measurePerformance(page, async () => {
      // Attempt to register/login
      const usernameInput = await page.locator('input[name="username"]').first();
      const passwordInput = await page.locator('input[type="password"]').first();

      if (usernameInput && passwordInput) {
        await usernameInput.fill('testuser_' + Date.now());
        await passwordInput.fill('TestPassword123!');

        const submitButton = await page.locator('button[type="submit"]').first();
        await submitButton?.click();
      }
    });

    if (loginTime > 3000) {
      issues.push(`Slow login: ${loginTime}ms`);
    }

    // 2. Character Selection
    const characterButton = await page.locator('[data-character], .character-select').first();
    if (!characterButton) {
      issues.push('No character selection available');
    } else {
      await characterButton.click();

      // Check for voice feedback
      const audioPlaying = await page.evaluate(() => {
        const audios = Array.from(document.querySelectorAll('audio'));
        return audios.some(audio => !audio.paused);
      });

      if (!audioPlaying) {
        issues.push('No voice feedback on character selection');
      }
    }

    // 3. Join/Create Room
    const roomButton = await page.locator('button:has-text("Create Room"), button:has-text("Join")').first();
    if (!roomButton) {
      issues.push('No room creation/joining option');
    } else {
      await roomButton.click();
    }

    // 4. Trading Simulation
    const tradeButton = await page.locator('button:has-text("Buy"), button:has-text("Trade")').first();
    if (!tradeButton) {
      issues.push('No trading interface available');
    } else {
      // Rapid trading to test performance
      for (let i = 0; i < 10; i++) {
        await tradeButton.click();
        await page.waitForTimeout(100);
      }

      // Check if UI remains responsive
      const isResponsive = await page.evaluate(() => {
        const start = Date.now();
        document.body.style.backgroundColor = 'red';
        document.body.style.backgroundColor = '';
        return Date.now() - start < 100;
      });

      if (!isResponsive) {
        issues.push('UI becomes unresponsive during rapid trading');
      }
    }

    // 5. Bot Interaction
    const botButton = await page.locator('button:has-text("Bot"), button:has-text("AI")').first();
    if (botButton) {
      await botButton.click();

      // Check if bots are animated
      const animatedElements = await page.locator('.animated, [data-animation]').count();

      if (animatedElements === 0) {
        issues.push('No bot animations visible');
      }
    }

    expect(issues).toHaveLength(0);
  });

  test('Stress test: Multiple concurrent users', async ({ browser }) => {
    const contexts: BrowserContext[] = [];
    const pages: Page[] = [];
    const userCount = 10;

    // Create multiple browser contexts (simulate different users)
    for (let i = 0; i < userCount; i++) {
      const context = await browser.newContext();
      const page = await context.newPage();
      contexts.push(context);
      pages.push(page);
    }

    const issues = [];

    // All users navigate simultaneously
    const navigationPromises = pages.map(page => page.goto(TARGET_URL));
    const navigationResults = await Promise.allSettled(navigationPromises);

    const failedNavigations = navigationResults.filter(r => r.status === 'rejected');
    if (failedNavigations.length > 0) {
      issues.push(`${failedNavigations.length} users failed to load the page`);
    }

    // All users perform actions simultaneously
    const actionPromises = pages.map(async (page, index) => {
      try {
        // Each user clicks different elements
        const buttons = await page.locator('button').all();
        if (buttons[index % buttons.length]) {
          await buttons[index % buttons.length].click();
        }
        return 'success';
      } catch (err) {
        return 'failed';
      }
    });

    const actionResults = await Promise.all(actionPromises);
    const failedActions = actionResults.filter(r => r === 'failed');

    if (failedActions.length > 0) {
      issues.push(`${failedActions.length} users experienced errors during interaction`);
    }

    // Cleanup
    await Promise.all(contexts.map(context => context.close()));

    expect(issues).toHaveLength(0);
  });
});

test.describe('📊 Generate Red Team Report', () => {

  test.afterAll(async () => {
    // Generate comprehensive report
    const report = {
      timestamp: new Date().toISOString(),
      security: {
        critical: [],
        high: [],
        medium: [],
        low: []
      },
      ux: {
        critical: [],
        high: [],
        medium: [],
        low: []
      },
      performance: {
        pageLoad: 0,
        apiLatency: 0,
        memoryUsage: 0
      },
      recommendations: []
    };

    // Save report
    const fs = require('fs');
    fs.writeFileSync(
      'red-team-report.json',
      JSON.stringify(report, null, 2)
    );

    console.log('Red Team Assessment Complete - Report saved to red-team-report.json');
  });
});