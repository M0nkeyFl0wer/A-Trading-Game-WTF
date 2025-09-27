#!/usr/bin/env node

/**
 * UX Visual Testing for Termux
 * Since Playwright doesn't work on Termux, this simulates browser behavior
 * using Node.js to test the DOM structure and JavaScript functionality
 */

const http = require('http');
const { JSDOM } = require('jsdom');

const TARGET_URL = process.env.TEST_URL || 'http://localhost:3001';
const REPORT_FILE = `ux-test-report-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.json`;

class UXTester {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      target: TARGET_URL,
      tests: [],
      summary: { passed: 0, failed: 0, warnings: 0 }
    };
  }

  log(test, status, message, details = {}) {
    const result = {
      test,
      status,
      message,
      timestamp: new Date().toISOString(),
      ...details
    };

    this.results.tests.push(result);
    this.results.summary[status.toLowerCase()]++;

    const colors = {
      PASS: '\x1b[32m✓\x1b[0m',
      FAIL: '\x1b[31m✗\x1b[0m',
      WARN: '\x1b[33m⚠\x1b[0m'
    };

    console.log(`${colors[status] || '?'} ${test}: ${message}`);
  }

  async fetchPage() {
    return new Promise((resolve, reject) => {
      const req = http.get(TARGET_URL, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve(data));
      });

      req.on('error', reject);
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }

  async testPageLoad() {
    console.log('\n🌐 Testing Page Load...');

    try {
      const startTime = Date.now();
      const html = await this.fetchPage();
      const loadTime = Date.now() - startTime;

      if (loadTime < 3000) {
        this.log('Page Load Time', 'PASS', `${loadTime}ms (target: <3000ms)`);
      } else {
        this.log('Page Load Time', 'FAIL', `${loadTime}ms (too slow)`);
      }

      if (html.includes('<!DOCTYPE html>')) {
        this.log('HTML Document', 'PASS', 'Valid HTML5 document');
      } else {
        this.log('HTML Document', 'FAIL', 'Invalid or missing DOCTYPE');
      }

      return html;
    } catch (error) {
      this.log('Page Load', 'FAIL', `Cannot load page: ${error.message}`);
      return null;
    }
  }

  async testDOMStructure(html) {
    console.log('\n📐 Testing DOM Structure...');

    try {
      const dom = new JSDOM(html, {
        url: TARGET_URL,
        runScripts: 'dangerously',
        resources: 'usable'
      });

      const { document } = dom.window;

      // Test essential elements
      const tests = [
        {
          selector: 'title',
          name: 'Page Title',
          required: true
        },
        {
          selector: 'meta[name="viewport"]',
          name: 'Mobile Viewport',
          required: true
        },
        {
          selector: '[data-character], .character-select, .character-gallery',
          name: 'Character Selection',
          required: true
        },
        {
          selector: 'button, input[type="button"], .btn',
          name: 'Interactive Buttons',
          required: true
        },
        {
          selector: 'canvas, .canvas, [data-animation]',
          name: 'Animation Canvas',
          required: false
        },
        {
          selector: '.voice-controls, [data-voice], audio',
          name: 'Voice Controls',
          required: false
        }
      ];

      tests.forEach(({ selector, name, required }) => {
        const elements = document.querySelectorAll(selector);

        if (elements.length > 0) {
          this.log(`DOM: ${name}`, 'PASS', `Found ${elements.length} elements`);
        } else if (required) {
          this.log(`DOM: ${name}`, 'FAIL', 'Required element missing');
        } else {
          this.log(`DOM: ${name}`, 'WARN', 'Optional element missing');
        }
      });

      return dom;
    } catch (error) {
      this.log('DOM Parsing', 'FAIL', `Cannot parse DOM: ${error.message}`);
      return null;
    }
  }

  async testAccessibility(dom) {
    console.log('\n♿ Testing Accessibility...');

    if (!dom) return;

    const { document } = dom.window;

    // Test images without alt text
    const imagesWithoutAlt = document.querySelectorAll('img:not([alt])');
    if (imagesWithoutAlt.length === 0) {
      this.log('A11Y: Image Alt Text', 'PASS', 'All images have alt attributes');
    } else {
      this.log('A11Y: Image Alt Text', 'FAIL', `${imagesWithoutAlt.length} images missing alt text`);
    }

    // Test form inputs without labels
    const inputs = document.querySelectorAll('input, select, textarea');
    let unlabeledInputs = 0;

    inputs.forEach(input => {
      const id = input.id;
      if (!id || !document.querySelector(`label[for="${id}"]`)) {
        unlabeledInputs++;
      }
    });

    if (inputs.length === 0) {
      this.log('A11Y: Form Labels', 'WARN', 'No form inputs found');
    } else if (unlabeledInputs === 0) {
      this.log('A11Y: Form Labels', 'PASS', 'All inputs have labels');
    } else {
      this.log('A11Y: Form Labels', 'FAIL', `${unlabeledInputs}/${inputs.length} inputs missing labels`);
    }

    // Test heading hierarchy
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    if (headings.length === 0) {
      this.log('A11Y: Heading Structure', 'WARN', 'No headings found');
    } else {
      const h1Count = document.querySelectorAll('h1').length;
      if (h1Count === 1) {
        this.log('A11Y: Heading Structure', 'PASS', 'Proper heading hierarchy');
      } else {
        this.log('A11Y: Heading Structure', h1Count === 0 ? 'FAIL' : 'WARN', `${h1Count} H1 elements found`);
      }
    }
  }

  async testResponsiveDesign(html) {
    console.log('\n📱 Testing Responsive Design...');

    // Test viewport meta tag
    if (html.includes('viewport')) {
      this.log('Responsive: Viewport Meta', 'PASS', 'Viewport meta tag present');
    } else {
      this.log('Responsive: Viewport Meta', 'FAIL', 'Missing viewport meta tag');
    }

    // Test for responsive CSS patterns
    const responsivePatterns = [
      '@media',
      'max-width',
      'min-width',
      'flex',
      'grid'
    ];

    let responsiveFeatures = 0;
    responsivePatterns.forEach(pattern => {
      if (html.includes(pattern)) {
        responsiveFeatures++;
      }
    });

    if (responsiveFeatures >= 3) {
      this.log('Responsive: CSS Features', 'PASS', `${responsiveFeatures}/5 responsive patterns found`);
    } else {
      this.log('Responsive: CSS Features', 'WARN', `Only ${responsiveFeatures}/5 responsive patterns found`);
    }
  }

  async testPerformance(html) {
    console.log('\n⚡ Testing Performance...');

    // Test page size
    const sizeKB = Math.round(html.length / 1024);
    if (sizeKB < 500) {
      this.log('Performance: Page Size', 'PASS', `${sizeKB}KB (efficient)`);
    } else if (sizeKB < 1000) {
      this.log('Performance: Page Size', 'WARN', `${sizeKB}KB (could be smaller)`);
    } else {
      this.log('Performance: Page Size', 'FAIL', `${sizeKB}KB (too large)`);
    }

    // Test for performance anti-patterns
    const issues = [];

    if (html.includes('document.write')) {
      issues.push('document.write() usage');
    }

    if ((html.match(/<script/g) || []).length > 10) {
      issues.push('Too many script tags');
    }

    if ((html.match(/<link.*stylesheet/g) || []).length > 5) {
      issues.push('Too many CSS files');
    }

    if (issues.length === 0) {
      this.log('Performance: Code Quality', 'PASS', 'No performance anti-patterns detected');
    } else {
      this.log('Performance: Code Quality', 'WARN', `Issues: ${issues.join(', ')}`);
    }
  }

  async testGameSpecific(dom) {
    console.log('\n🎮 Testing Game-Specific Features...');

    if (!dom) return;

    const { document } = dom.window;

    // Test for character elements
    const characters = ['DEALER', 'BULL', 'BEAR', 'WHALE', 'ROOKIE'];
    let foundCharacters = 0;

    characters.forEach(char => {
      if (document.querySelector(`[data-character="${char}"]`) ||
          document.body.innerHTML.includes(char)) {
        foundCharacters++;
      }
    });

    this.log('Game: Character System', foundCharacters === 5 ? 'PASS' : 'WARN',
             `${foundCharacters}/5 characters found in DOM`);

    // Test for trading interface
    const tradingElements = [
      'buy', 'sell', 'trade', 'portfolio', 'balance', 'market'
    ];

    let tradingFeatures = 0;
    tradingElements.forEach(element => {
      if (document.body.innerHTML.toLowerCase().includes(element)) {
        tradingFeatures++;
      }
    });

    this.log('Game: Trading Interface', tradingFeatures >= 3 ? 'PASS' : 'WARN',
             `${tradingFeatures}/6 trading features detected`);

    // Test for voice/audio elements
    const audioElements = document.querySelectorAll('audio, [data-voice], .voice');
    if (audioElements.length > 0) {
      this.log('Game: Audio System', 'PASS', `${audioElements.length} audio elements found`);
    } else {
      this.log('Game: Audio System', 'WARN', 'No audio elements detected');
    }
  }

  async testErrorHandling() {
    console.log('\n🚨 Testing Error Handling...');

    // Test 404 handling
    try {
      const response = await this.makeRequest('/nonexistent-page');
      if (response.includes('404') || response.includes('Not Found')) {
        this.log('Error: 404 Handling', 'PASS', 'Custom 404 page detected');
      } else {
        this.log('Error: 404 Handling', 'WARN', 'Generic 404 response');
      }
    } catch (error) {
      this.log('Error: 404 Handling', 'FAIL', 'Cannot test 404 handling');
    }

    // Test API error handling
    try {
      const response = await this.makeRequest('/api/nonexistent');
      if (response.includes('error') || response.includes('Error')) {
        this.log('Error: API Errors', 'PASS', 'API returns error messages');
      } else {
        this.log('Error: API Errors', 'WARN', 'API might not handle errors properly');
      }
    } catch (error) {
      this.log('Error: API Errors', 'WARN', 'Cannot test API error handling');
    }
  }

  async makeRequest(path) {
    return new Promise((resolve, reject) => {
      const req = http.get(`${TARGET_URL}${path}`, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve(data));
      });

      req.on('error', reject);
      req.setTimeout(5000, () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
    });
  }

  generateReport() {
    const { passed, failed, warnings } = this.results.summary;
    const total = passed + failed + warnings;
    const score = Math.round((passed / total) * 100);

    console.log('\n📊 UX TEST RESULTS');
    console.log('==================');
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`⚠️  Warnings: ${warnings}`);
    console.log(`📈 UX Score: ${score}%`);

    let status;
    if (score >= 80) {
      status = '\x1b[32mEXCELLENT UX\x1b[0m 🏆';
    } else if (score >= 70) {
      status = '\x1b[33mGOOD UX\x1b[0m ✅';
    } else if (score >= 60) {
      status = '\x1b[33mNEEDS IMPROVEMENT\x1b[0m ⚠️';
    } else {
      status = '\x1b[31mPOOR UX\x1b[0m ❌';
    }

    console.log(`🎯 Status: ${status}`);

    // Save detailed report
    require('fs').writeFileSync(REPORT_FILE, JSON.stringify(this.results, null, 2));
    console.log(`\n📋 Detailed report saved to: ${REPORT_FILE}`);

    return score;
  }

  async runAllTests() {
    console.log('🎮 A Trading Game WTF - UX Testing Suite');
    console.log('=========================================');

    try {
      const html = await this.testPageLoad();
      if (html) {
        const dom = await this.testDOMStructure(html);
        await this.testAccessibility(dom);
        await this.testResponsiveDesign(html);
        await this.testPerformance(html);
        await this.testGameSpecific(dom);
        await this.testErrorHandling();
      }

      const score = this.generateReport();
      process.exit(score >= 70 ? 0 : 1);
    } catch (error) {
      console.error('❌ Testing failed:', error.message);
      process.exit(1);
    }
  }
}

// Install JSDOM if not available
try {
  require('jsdom');
} catch (error) {
  console.log('📦 Installing JSDOM for DOM testing...');
  require('child_process').execSync('npm install jsdom', { stdio: 'inherit' });
  console.log('✅ JSDOM installed successfully');
}

// Run tests
if (require.main === module) {
  const tester = new UXTester();
  tester.runAllTests();
}

module.exports = UXTester;