#!/usr/bin/env node

/**
 * Gemini AI Sub-Agent for UX Analysis
 * Uses Gemini to analyze UX test results and provide recommendations
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class GeminiUXAnalyst {
  constructor(apiKey) {
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
      this.model = this.genAI.getGenerativeModel({ model: 'gemini-pro' });
      this.useAPI = true;
    } else {
      console.log('⚠️  No API key provided, will try CLI fallback');
      this.useAPI = false;
    }
  }

  async analyzeWithAPI(prompt) {
    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (error) {
      console.error('API Error:', error.message);
      return null;
    }
  }

  async analyzeWithCLI(prompt) {
    try {
      // Write prompt to temp file to avoid shell escaping issues
      const tempFile = `/tmp/gemini-prompt-${Date.now()}.txt`;
      fs.writeFileSync(tempFile, prompt);

      const { stdout, stderr } = await execPromise(`cat ${tempFile} | gemini`);

      // Clean up temp file
      fs.unlinkSync(tempFile);

      if (stderr) {
        console.error('CLI Error:', stderr);
        return null;
      }

      return stdout;
    } catch (error) {
      console.error('CLI Error:', error.message);
      return null;
    }
  }

  async analyze(prompt) {
    if (this.useAPI) {
      return await this.analyzeWithAPI(prompt);
    } else {
      return await this.analyzeWithCLI(prompt);
    }
  }

  async analyzeUXTestResults(testResults) {
    console.log('\n🤖 Gemini UX Analysis Starting...\n');

    const prompt = `
You are a UX/UI expert analyzing test results for a voice-enabled trading game with AI characters.

Test Results:
${JSON.stringify(testResults, null, 2)}

Please provide:
1. TOP 3 CRITICAL UX ISSUES that must be fixed immediately
2. TOP 3 QUICK WINS that would significantly improve user experience
3. ACCESSIBILITY SCORE (1-10) with specific improvements needed
4. MOBILE READINESS assessment
5. PERFORMANCE optimization recommendations
6. ONE CREATIVE SUGGESTION to make the game more engaging

Format your response clearly with headers and bullet points.
`;

    const analysis = await this.analyze(prompt);

    if (analysis) {
      console.log('📊 GEMINI UX ANALYSIS REPORT');
      console.log('============================\n');
      console.log(analysis);
      return analysis;
    } else {
      console.log('❌ Failed to get Gemini analysis');
      return null;
    }
  }

  async analyzeScreenshot(imagePath) {
    if (!this.useAPI) {
      console.log('⚠️  Screenshot analysis requires API key');
      return null;
    }

    console.log('\n🖼️ Analyzing screenshot with Gemini Vision...\n');

    try {
      const imageData = fs.readFileSync(imagePath);
      const base64Image = imageData.toString('base64');

      const prompt = `
Analyze this screenshot of a trading game interface and provide:

1. VISUAL HIERARCHY - Is the most important information prominent?
2. COLOR SCHEME - Does it work for the trading/gaming context?
3. TYPOGRAPHY - Is text readable and appropriate?
4. SPACING - Are elements properly spaced and aligned?
5. CALL-TO-ACTION - Are buttons and interactive elements clear?
6. VISUAL BUGS - Any rendering issues or misalignments?
7. IMPROVEMENT SUGGESTIONS - Top 3 visual improvements needed

Be specific and actionable in your feedback.
`;

      const model = this.genAI.getGenerativeModel({ model: 'gemini-pro-vision' });
      const result = await model.generateContent([
        prompt,
        {
          inlineData: {
            mimeType: 'image/png',
            data: base64Image
          }
        }
      ]);

      const response = await result.response;
      const analysis = response.text();

      console.log('🎨 VISUAL ANALYSIS REPORT');
      console.log('========================\n');
      console.log(analysis);

      return analysis;
    } catch (error) {
      console.error('Vision analysis error:', error.message);
      return null;
    }
  }

  async suggestImprovements(currentImplementation) {
    const prompt = `
As a UX expert, review this implementation for a voice-enabled trading game:

${currentImplementation}

Suggest improvements for:
1. USER ONBOARDING - How to make first-time experience smoother
2. ENGAGEMENT LOOPS - What keeps users coming back
3. SOCIAL FEATURES - How to enhance multiplayer experience
4. MONETIZATION - Ethical ways to generate revenue
5. ACCESSIBILITY - Making it usable for everyone

Provide specific, implementable suggestions.
`;

    const suggestions = await this.analyze(prompt);

    if (suggestions) {
      console.log('\n💡 IMPROVEMENT SUGGESTIONS');
      console.log('=========================\n');
      console.log(suggestions);
      return suggestions;
    }

    return null;
  }

  async compareWithCompetitors() {
    const prompt = `
Compare a voice-enabled AI trading game against popular trading/investment games:

Our Game Features:
- 5 AI characters with unique voices and personalities
- Real-time trading simulation
- Character-based strategies
- Visual animations
- Multiplayer rooms

How does this compare to:
1. Robinhood's gamification
2. eToro's social trading
3. Popular trading simulators

What unique value proposition should we emphasize?
What features are we missing that users expect?
`;

    const comparison = await this.analyze(prompt);

    if (comparison) {
      console.log('\n🏆 COMPETITIVE ANALYSIS');
      console.log('======================\n');
      console.log(comparison);
      return comparison;
    }

    return null;
  }

  async generateUserPersonas() {
    const prompt = `
Create 3 detailed user personas for a voice-enabled AI trading game:

For each persona include:
- Name and demographics
- Trading experience level
- Gaming preferences
- Why they would play this game
- What features they'd love most
- Potential frustrations
- How to keep them engaged

Make them realistic and diverse.
`;

    const personas = await this.analyze(prompt);

    if (personas) {
      console.log('\n👥 USER PERSONAS');
      console.log('===============\n');
      console.log(personas);
      return personas;
    }

    return null;
  }

  async createTestingChecklist(features) {
    const prompt = `
Create a comprehensive UX testing checklist for these features:

${features}

Include:
1. FUNCTIONAL TESTS - Does everything work?
2. USABILITY TESTS - Is it easy to use?
3. EDGE CASES - What could break?
4. PERFORMANCE TESTS - Is it fast enough?
5. ACCESSIBILITY TESTS - Can everyone use it?

Format as a checklist that testers can follow.
`;

    const checklist = await this.analyze(prompt);

    if (checklist) {
      console.log('\n✅ UX TESTING CHECKLIST');
      console.log('======================\n');
      console.log(checklist);
      return checklist;
    }

    return null;
  }

  async generateReport(allAnalysis) {
    const report = {
      timestamp: new Date().toISOString(),
      analyses: allAnalysis,
      summary: {
        critical_issues: [],
        quick_wins: [],
        long_term_improvements: []
      }
    };

    const reportFile = `gemini-ux-report-${Date.now()}.json`;
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));

    console.log(`\n📄 Full report saved to: ${reportFile}`);
    return reportFile;
  }
}

// Function to run a complete UX analysis
async function runCompleteAnalysis(apiKey) {
  const analyst = new GeminiUXAnalyst(apiKey);

  // Load test results if available
  let testResults = {};
  try {
    const files = fs.readdirSync('.')
      .filter(f => f.includes('test-report') && f.endsWith('.json'))
      .sort();

    if (files.length > 0) {
      const latestReport = files[files.length - 1];
      testResults = JSON.parse(fs.readFileSync(latestReport, 'utf-8'));
      console.log(`📊 Loaded test results from: ${latestReport}`);
    }
  } catch (error) {
    console.log('⚠️  No test results found, using mock data');
    testResults = {
      visual_elements: 'Some buttons found, character selection missing',
      performance: 'Page loads in 83ms',
      accessibility: 'Missing alt text, no headings',
      mobile: 'Not fully responsive'
    };
  }

  const allAnalysis = {};

  // Run various analyses
  console.log('🚀 Starting comprehensive UX analysis...\n');

  allAnalysis.testResults = await analyst.analyzeUXTestResults(testResults);
  allAnalysis.improvements = await analyst.suggestImprovements(
    'Voice-enabled trading game with 5 AI characters'
  );
  allAnalysis.competitors = await analyst.compareWithCompetitors();
  allAnalysis.personas = await analyst.generateUserPersonas();
  allAnalysis.checklist = await analyst.createTestingChecklist(
    'Character selection, Voice controls, Trading interface, Multiplayer rooms'
  );

  // Check for screenshots to analyze
  const screenshots = fs.readdirSync('.')
    .filter(f => f.startsWith('screenshot') && f.endsWith('.png'));

  if (screenshots.length > 0 && apiKey) {
    const latestScreenshot = screenshots[screenshots.length - 1];
    console.log(`\n🖼️ Found screenshot: ${latestScreenshot}`);
    allAnalysis.visual = await analyst.analyzeScreenshot(latestScreenshot);
  }

  // Generate final report
  const reportPath = await analyst.generateReport(allAnalysis);

  console.log('\n✨ GEMINI UX ANALYSIS COMPLETE! ✨');
  console.log('==================================');
  console.log('Review the detailed report for actionable insights.\n');

  return reportPath;
}

// Check if API client is installed
try {
  require('@google/generative-ai');
} catch (error) {
  console.log('📦 Installing Gemini AI SDK...');
  require('child_process').execSync('npm install @google/generative-ai',
    { stdio: 'inherit' });
}

// Command line usage
if (require.main === module) {
  const apiKey = process.env.GEMINI_API_KEY || process.argv[2];

  if (!apiKey) {
    console.log('⚠️  No API key provided');
    console.log('Usage: node gemini-ux-analyst.js YOUR_API_KEY');
    console.log('Or set GEMINI_API_KEY environment variable');
    console.log('\nAttempting to use CLI fallback...\n');
  }

  runCompleteAnalysis(apiKey).catch(console.error);
}

module.exports = { GeminiUXAnalyst, runCompleteAnalysis };