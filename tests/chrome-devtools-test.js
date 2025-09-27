#!/usr/bin/env node

/**
 * Chrome DevTools Visual Testing for Termux
 * Uses Chrome DevTools Protocol for real browser testing
 */

const CDP = require('chrome-remote-interface');
const fs = require('fs');
const path = require('path');

class ChromeDevToolsTester {
  constructor(options = {}) {
    this.host = options.host || 'localhost';
    this.port = options.port || 9222;
    this.targetUrl = options.url || 'http://localhost:3001';
    this.results = [];
  }

  async connect() {
    try {
      console.log('🔌 Connecting to Chrome DevTools...');
      this.client = await CDP({
        host: this.host,
        port: this.port
      });

      const { Network, Page, Runtime, DOM, CSS } = this.client;
      this.Network = Network;
      this.Page = Page;
      this.Runtime = Runtime;
      this.DOM = DOM;
      this.CSS = CSS;

      await Network.enable();
      await Page.enable();
      await Runtime.enable();
      await DOM.enable();
      await CSS.enable();

      console.log('✅ Connected to Chrome DevTools');
      return true;
    } catch (error) {
      console.error('❌ Failed to connect:', error.message);
      console.log('\n📝 To use Chrome DevTools testing:');
      console.log('1. Install Chromium: pkg install chromium');
      console.log('2. Start with remote debugging:');
      console.log('   chromium --headless --remote-debugging-port=9222 --no-sandbox');
      console.log('3. Run this test again');
      return false;
    }
  }

  async navigateToPage() {
    console.log(`\n🌐 Navigating to ${this.targetUrl}...`);
    await this.Page.navigate({ url: this.targetUrl });
    await this.Page.loadEventFired();
    console.log('✅ Page loaded');
  }

  async testVisualElements() {
    console.log('\n🎨 Testing Visual Elements...');

    // Get DOM tree
    const { root } = await this.DOM.getDocument();

    // Test for character selection
    const characterElements = await this.DOM.querySelectorAll({
      nodeId: root.nodeId,
      selector: '[data-character], .character, .character-select'
    });

    this.log('Visual: Character Selection',
      characterElements.nodeIds.length > 0 ? 'PASS' : 'FAIL',
      `Found ${characterElements.nodeIds.length} character elements`);

    // Test for buttons
    const buttons = await this.DOM.querySelectorAll({
      nodeId: root.nodeId,
      selector: 'button, .btn'
    });

    this.log('Visual: Interactive Buttons',
      buttons.nodeIds.length > 0 ? 'PASS' : 'FAIL',
      `Found ${buttons.nodeIds.length} buttons`);

    // Test for animations
    const animations = await this.CSS.getAnimations();
    this.log('Visual: CSS Animations',
      animations.animations?.length > 0 ? 'PASS' : 'WARN',
      `${animations.animations?.length || 0} animations running`);
  }

  async testPerformance() {
    console.log('\n⚡ Testing Performance...');

    const metrics = await this.Page.getMetrics();

    // Check key performance metrics
    const jsHeapUsed = Math.round(metrics.metrics.JSHeapUsedSize / 1024 / 1024);
    const domNodes = metrics.metrics.Nodes;

    this.log('Performance: Memory Usage',
      jsHeapUsed < 50 ? 'PASS' : jsHeapUsed < 100 ? 'WARN' : 'FAIL',
      `${jsHeapUsed}MB heap used`);

    this.log('Performance: DOM Nodes',
      domNodes < 1000 ? 'PASS' : domNodes < 2000 ? 'WARN' : 'FAIL',
      `${domNodes} DOM nodes`);
  }

  async testJavaScriptExecution() {
    console.log('\n🚀 Testing JavaScript Execution...');

    // Check if React is loaded
    const reactCheck = await this.Runtime.evaluate({
      expression: 'typeof React !== "undefined"'
    });

    this.log('JavaScript: React Loaded',
      reactCheck.result.value ? 'PASS' : 'FAIL',
      reactCheck.result.value ? 'React is available' : 'React not found');

    // Check for game state
    const gameStateCheck = await this.Runtime.evaluate({
      expression: 'document.querySelector("#root")?.children.length > 0'
    });

    this.log('JavaScript: App Mounted',
      gameStateCheck.result.value ? 'PASS' : 'FAIL',
      gameStateCheck.result.value ? 'App is mounted' : 'App not mounted');

    // Check for console errors
    const errors = await this.Runtime.evaluate({
      expression: 'window.__errors || []'
    });

    this.log('JavaScript: Console Errors',
      !errors.result.value?.length ? 'PASS' : 'FAIL',
      `${errors.result.value?.length || 0} errors found`);
  }

  async captureScreenshot() {
    console.log('\n📸 Capturing Screenshot...');

    try {
      const { data } = await this.Page.captureScreenshot({
        format: 'png'
      });

      const filename = `screenshot-${Date.now()}.png`;
      fs.writeFileSync(filename, Buffer.from(data, 'base64'));

      this.log('Screenshot: Capture',
        'PASS',
        `Saved to ${filename}`);

      // Analyze screenshot for visual elements
      const imageSize = Buffer.from(data, 'base64').length;
      this.log('Screenshot: Size',
        imageSize > 1000 ? 'PASS' : 'WARN',
        `${Math.round(imageSize / 1024)}KB`);

    } catch (error) {
      this.log('Screenshot: Capture', 'FAIL', error.message);
    }
  }

  async testAccessibility() {
    console.log('\n♿ Testing Accessibility...');

    // Get accessibility tree
    const { nodes } = await this.client.Accessibility.getFullAXTree();

    const buttons = nodes.filter(n => n.role?.value === 'button');
    const headings = nodes.filter(n => n.role?.value?.includes('heading'));
    const images = nodes.filter(n => n.role?.value === 'img');

    this.log('Accessibility: Buttons',
      buttons.length > 0 ? 'PASS' : 'WARN',
      `${buttons.length} accessible buttons`);

    this.log('Accessibility: Headings',
      headings.length > 0 ? 'PASS' : 'WARN',
      `${headings.length} heading elements`);

    // Check for alt text on images
    const imagesWithoutAlt = images.filter(img => !img.name?.value);
    this.log('Accessibility: Image Alt Text',
      imagesWithoutAlt.length === 0 ? 'PASS' : 'FAIL',
      `${imagesWithoutAlt.length} images missing alt text`);
  }

  async testMobileViewport() {
    console.log('\n📱 Testing Mobile Viewport...');

    // Set mobile viewport
    await this.Page.setDeviceMetricsOverride({
      width: 375,
      height: 812,
      deviceScaleFactor: 2,
      mobile: true
    });

    await this.Page.reload();
    await this.Page.loadEventFired();

    // Check layout
    const viewport = await this.Runtime.evaluate({
      expression: 'document.documentElement.scrollWidth <= window.innerWidth'
    });

    this.log('Mobile: No Horizontal Scroll',
      viewport.result.value ? 'PASS' : 'FAIL',
      viewport.result.value ? 'Responsive layout' : 'Horizontal scroll detected');

    // Reset viewport
    await this.Page.setDeviceMetricsOverride({
      width: 0,
      height: 0,
      deviceScaleFactor: 0,
      mobile: false
    });
  }

  async testNetworkRequests() {
    console.log('\n🌐 Testing Network Performance...');

    const requests = [];

    this.Network.requestWillBeSent((params) => {
      requests.push({
        url: params.request.url,
        method: params.request.method,
        timestamp: params.timestamp
      });
    });

    // Reload page to capture all requests
    await this.Page.reload();
    await this.Page.loadEventFired();

    // Wait for requests to complete
    await new Promise(resolve => setTimeout(resolve, 2000));

    const apiRequests = requests.filter(r => r.url.includes('/api/'));
    const assetRequests = requests.filter(r =>
      r.url.match(/\.(js|css|png|jpg|svg)$/));

    this.log('Network: API Requests',
      'INFO',
      `${apiRequests.length} API calls made`);

    this.log('Network: Asset Requests',
      assetRequests.length < 50 ? 'PASS' : 'WARN',
      `${assetRequests.length} assets loaded`);
  }

  log(test, status, message) {
    const colors = {
      PASS: '\x1b[32m✓\x1b[0m',
      FAIL: '\x1b[31m✗\x1b[0m',
      WARN: '\x1b[33m⚠\x1b[0m',
      INFO: '\x1b[34mℹ\x1b[0m'
    };

    console.log(`${colors[status] || '?'} ${test}: ${message}`);
    this.results.push({ test, status, message });
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
      console.log('\n👋 Disconnected from Chrome DevTools');
    }
  }

  generateReport() {
    console.log('\n📊 CHROME DEVTOOLS TEST RESULTS');
    console.log('================================');

    const counts = { PASS: 0, FAIL: 0, WARN: 0, INFO: 0 };
    this.results.forEach(r => counts[r.status]++);

    console.log(`✅ Passed: ${counts.PASS}`);
    console.log(`❌ Failed: ${counts.FAIL}`);
    console.log(`⚠️  Warnings: ${counts.WARN}`);
    console.log(`ℹ️  Info: ${counts.INFO}`);

    const total = counts.PASS + counts.FAIL + counts.WARN;
    const score = Math.round((counts.PASS / total) * 100);
    console.log(`\n🎯 Visual Test Score: ${score}%`);

    // Save detailed report
    const reportFile = `devtools-report-${Date.now()}.json`;
    fs.writeFileSync(reportFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      targetUrl: this.targetUrl,
      results: this.results,
      score
    }, null, 2));

    console.log(`\n📋 Detailed report saved to: ${reportFile}`);
    return score;
  }

  async runAllTests() {
    console.log('🎮 Chrome DevTools Visual Testing');
    console.log('==================================\n');

    const connected = await this.connect();
    if (!connected) {
      return;
    }

    try {
      await this.navigateToPage();
      await this.testVisualElements();
      await this.testJavaScriptExecution();
      await this.testPerformance();
      await this.testAccessibility();
      await this.testMobileViewport();
      await this.testNetworkRequests();
      await this.captureScreenshot();

      const score = this.generateReport();
      process.exit(score >= 70 ? 0 : 1);

    } catch (error) {
      console.error('❌ Test failed:', error);
      process.exit(1);
    } finally {
      await this.disconnect();
    }
  }
}

// Check if chrome-remote-interface is installed
try {
  require('chrome-remote-interface');
} catch (error) {
  console.log('📦 Installing chrome-remote-interface...');
  require('child_process').execSync('npm install chrome-remote-interface',
    { stdio: 'inherit' });
}

// Run the test
if (require.main === module) {
  const tester = new ChromeDevToolsTester({
    url: process.argv[2] || 'http://localhost:3001'
  });

  tester.runAllTests();
}

module.exports = ChromeDevToolsTester;