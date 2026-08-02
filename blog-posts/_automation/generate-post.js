#!/usr/bin/env node

/**
 * Blog Post Generator
 * Analyzes recent development work and generates blog post drafts
 * Usage: node generate-post.js [type] [commit-range]
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

class BlogPostGenerator {
  constructor() {
    this.templatesDir = path.join(__dirname, '..', 'templates');
    this.draftsDir = path.join(__dirname, '..', 'drafts');

    // Find git repository root
    this.repoRoot = this.findGitRoot();

    // Ensure drafts directory exists
    if (!fs.existsSync(this.draftsDir)) {
      fs.mkdirSync(this.draftsDir, { recursive: true });
    }
  }

  findGitRoot() {
    let currentDir = __dirname;
    while (currentDir !== path.dirname(currentDir)) {
      // Stop at root directory
      if (fs.existsSync(path.join(currentDir, '.git'))) {
        return currentDir;
      }
      currentDir = path.dirname(currentDir);
    }
    throw new Error('Could not find git repository root');
  }

  async generatePost(
    postType = 'technical-deep-dive',
    commitRange = 'HEAD~10..HEAD',
  ) {
    console.log(`🔍 Analyzing recent work (${commitRange})...`);

    // Analyze recent commits
    const analysis = this.analyzeCommits(commitRange);

    // Load template
    const template = this.loadTemplate(postType);

    // Generate content
    const content = this.fillTemplate(template, analysis, postType);

    // Save draft
    const filename = this.generateFilename(postType, analysis);
    const filepath = path.join(this.draftsDir, filename);
    fs.writeFileSync(filepath, content, 'utf8');

    console.log(`✅ Blog post draft created: ${filepath}`);
    console.log(`📝 Type: ${postType}`);
    console.log(
      `📊 Analysis: ${analysis.commits.length} commits, ${analysis.filesChanged.length} files modified`,
    );

    return filepath;
  }

  analyzeCommits(commitRange) {
    try {
      // Get commit messages and files changed
      const gitLog = execSync(
        `git log --oneline --pretty=format:"%h|%s|%an|%ad" --date=short ${commitRange}`,
        {
          cwd: this.repoRoot,
          encoding: 'utf8',
        },
      );

      const commits = gitLog
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
          const [hash, message, author, date] = line.split('|');
          return { hash, message, author, date };
        });

      // Get files changed
      const filesChanged = execSync(`git diff --name-only ${commitRange}`, {
        cwd: this.repoRoot,
        encoding: 'utf8',
      })
        .split('\n')
        .filter((file) => file.trim());

      // Analyze work patterns
      const workAnalysis = this.analyzeWork(commits, filesChanged);

      return {
        commits,
        filesChanged,
        ...workAnalysis,
      };
    } catch (error) {
      console.error('Error analyzing commits:', error.message);
      return { commits: [], filesChanged: [], analysis: {} };
    }
  }

  analyzeWork(commits, filesChanged) {
    // Categorize the work
    const categories = {
      memory: ['memory', 'summarizer', 'context'],
      language: ['language', 'bilingual', 'spanish', 'multilingual'],
      ui: ['ui', 'component', 'animation', 'message'],
      docs: ['docs', 'documentation', 'readme'],
      ai: ['ai', 'model', 'provider', 'tool'],
      architecture: ['architecture', 'structure', 'pattern'],
    };

    const workCategories = [];
    const technicalChallenges = [];
    const featuresAdded = [];

    commits.forEach((commit) => {
      const message = commit.message.toLowerCase();

      // Detect work categories
      Object.entries(categories).forEach(([category, keywords]) => {
        if (keywords.some((keyword) => message.includes(keyword))) {
          if (!workCategories.includes(category)) {
            workCategories.push(category);
          }
        }
      });

      // Detect challenges/learning moments
      if (
        message.includes('fix') ||
        message.includes('resolve') ||
        message.includes('issue')
      ) {
        technicalChallenges.push(commit.message);
      }

      // Detect new features
      if (
        message.includes('add') ||
        message.includes('implement') ||
        message.includes('create')
      ) {
        featuresAdded.push(commit.message);
      }
    });

    return {
      workCategories,
      technicalChallenges,
      featuresAdded,
      primaryCategory: workCategories[0] || 'general',
      complexity: this.assessComplexity(commits.length, filesChanged.length),
    };
  }

  assessComplexity(commitCount, fileCount) {
    if (commitCount > 20 || fileCount > 15) return 'high';
    if (commitCount > 10 || fileCount > 8) return 'medium';
    return 'low';
  }

  loadTemplate(templateName) {
    const templatePath = path.join(this.templatesDir, `${templateName}.md`);
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template not found: ${templatePath}`);
    }
    return fs.readFileSync(templatePath, 'utf8');
  }

  fillTemplate(template, analysis, postType) {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const complexity = analysis.complexity;
    const primaryWork = analysis.primaryCategory;

    // Generate dynamic content based on analysis
    const replacements = {
      TITLE: this.generateTitle(analysis, postType),
      SUBTITLE: this.generateSubtitle(analysis, postType),
      DATE: date,
      READING_TIME: this.estimateReadingTime(analysis),
      TAGS: this.generateTags(analysis),
      PROBLEM_STATEMENT: this.generateProblemStatement(analysis),
      SPECIFIC_CHALLENGE:
        analysis.technicalChallenges[0] || 'technical challenge',
      ARCHITECTURE_DIAGRAM: this.generateArchitectureDiagram(analysis),
      COMPONENT_1_NAME: this.getMainComponent(analysis),
      COMPONENT_1_PURPOSE: `${analysis.primaryCategory} functionality`,
      COMPONENT_1_BENEFIT: `improved ${analysis.primaryCategory} capabilities`,
      COMPONENT_2_NAME: this.getSecondaryComponent(analysis),
      COMPONENT_2_FEATURE: `enhanced ${analysis.primaryCategory} features`,
      COMPONENT_2_IMPACT: `better ${analysis.primaryCategory} performance`,
      INTEGRATION_POINT_1: `System integration for ${analysis.primaryCategory}`,
      INTEGRATION_1_DESCRIPTION: `Seamless ${analysis.primaryCategory} integration with existing architecture`,
      INTEGRATION_POINT_2: `Error handling and fallbacks`,
      INTEGRATION_2_DESCRIPTION: `Robust error handling with graceful degradation`,
      INTEGRATION_POINT_3: `Performance optimization`,
      INTEGRATION_3_DESCRIPTION: `Optimized for production performance and scalability`,
      METRIC_1_NAME: `Development Time`,
      METRIC_1_BEFORE: `${analysis.commits.length * 2} hours`,
      METRIC_1_AFTER: `${Math.round(analysis.commits.length * 1.5)} hours`,
      METRIC_1_IMPROVEMENT: `25% faster development`,
      METRIC_2_NAME: `${analysis.primaryCategory} Performance`,
      METRIC_2_BEFORE: `Basic implementation`,
      METRIC_2_AFTER: `Advanced system`,
      METRIC_2_IMPROVEMENT: `300% improvement`,
      METRIC_3_NAME: `Code Quality`,
      METRIC_3_BEFORE: `Working solution`,
      METRIC_3_AFTER: `Production-ready`,
      METRIC_3_IMPROVEMENT: `Enterprise-grade`,
      FALLBACK_SCENARIO: `system downtime or API failures`,
      FALLBACK_BENEFIT: `uninterrupted service and error recovery`,
      ERROR_RECOVERY_MECHANISM: `Circuit breaker pattern`,
      ERROR_IMPACT: `service interruptions`,
      RECOVERY_METHOD: `automatic failover to backup systems`,
      LESSON_1_TITLE: `Pattern matching beats pure AI`,
      LESSON_1_DESCRIPTION: `Combining rule-based extraction with AI processing provides more reliable results`,
      LESSON_2_TITLE: `SSR compatibility is crucial`,
      LESSON_2_DESCRIPTION: `Planning for server-side rendering from the start saves significant refactoring time`,
      LESSON_3_TITLE: `User experience drives architecture`,
      LESSON_3_DESCRIPTION: `Delightful UX often requires sophisticated technical solutions`,
      IMPROVEMENT_1: `Add semantic search capabilities`,
      IMPROVEMENT_1_DETAIL: `Enable searching facts by meaning rather than just keywords`,
      IMPROVEMENT_2: `Implement entity linking`,
      IMPROVEMENT_2_DETAIL: `Connect related facts and information across conversations`,
      CONCLUSION_SUMMARY: `This implementation demonstrates the power of thoughtful architecture in creating delightful user experiences`,
      KEY_INSIGHT: `sometimes the smallest UX improvements come from the most sophisticated technical implementations`,
      MAIN_FILE: `lib/ai/${analysis.primaryCategory}.ts`,
      GITHUB_LINK: `https://github.com/your-repo/lib/ai/${analysis.primaryCategory}.ts`,
      CONFIG_FILE: `Environment variables and configuration`,
      TEST_FILE: `Comprehensive test coverage`,
      REPO_URL: `https://github.com/your-repo`,
      USER_IMPACT_STATEMENT: `significant improvement in user experience and system reliability`,
      BENEFIT_1: `Enhanced ${analysis.primaryCategory} capabilities`,
      BENEFIT_1_DETAIL: `More sophisticated and reliable ${analysis.primaryCategory} processing`,
      BENEFIT_2: `Better error handling`,
      BENEFIT_2_DETAIL: `Graceful degradation and user-friendly error messages`,
      BENEFIT_3: `Improved performance`,
      BENEFIT_3_DETAIL: `Faster response times and better resource utilization`,
      AUTHOR_NAME: `Your Name`,
      AUTHOR_ROLE: `Full-Stack Developer & AI Engineer`,
      AUTHOR_INTEREST: `building delightful user experiences with modern web technologies`,
      AUTHOR_HOBBY: `exploring how AI can enhance human creativity`,
      TWITTER_LINK: `https://twitter.com/your-handle`,
      LINKEDIN_LINK: `https://linkedin.com/in/your-profile`,
      GITHUB_PROFILE: `https://github.com/your-username`,
      SERIES_LINK: `/series/building-ai-systems`,
      RELATED_POST_1: `From Vercel Template to Production`,
      RELATED_LINK_1: `/blog/from-template-to-production`,
      RELATED_POST_2: `Building Animated Thinking Messages`,
      RELATED_LINK_2: `/blog/animated-thinking-messages`,
    };

    let content = template;
    Object.entries(replacements).forEach(([key, value]) => {
      content = content.replace(new RegExp(`{{${key}}}`, 'g'), value);
    });

    return content;
  }

  generateTitle(analysis, postType) {
    const categoryTitles = {
      memory: 'Advanced Memory Systems in Modern AI Applications',
      language: 'Building True Multilingual Support in React Applications',
      ui: 'Crafting Delightful User Experiences with Subtle Animations',
      docs: 'The Art of Self-Documenting Codebases',
      ai: 'From Simple Prompts to Sophisticated AI Systems',
      architecture: 'Architectural Decisions in Scalable AI Applications',
    };

    return (
      categoryTitles[analysis.primaryCategory] ||
      'Technical Implementation and Learning Journey'
    );
  }

  generateSubtitle(analysis, postType) {
    const subtitles = {
      'technical-deep-dive':
        'A comprehensive technical exploration of implementation challenges and solutions',
      'learning-journey':
        'A real development story about iteration, mistakes, and breakthrough moments',
    };

    return (
      subtitles[postType] || 'Implementation details and architectural insights'
    );
  }

  generateTags(analysis) {
    const baseTags = ['javascript', 'typescript', 'react', 'nextjs'];
    const categoryTags = {
      memory: ['ai', 'memory-management', 'context-preservation'],
      language: ['i18n', 'multilingual', 'localization'],
      ui: ['ux', 'animations', 'user-experience'],
      ai: ['artificial-intelligence', 'machine-learning', 'chatbots'],
    };

    return [
      ...baseTags,
      ...(categoryTags[analysis.primaryCategory] || []),
    ].join(', ');
  }

  generateProblemStatement(analysis) {
    const problemStatements = {
      memory:
        'Traditional AI chatbots struggle to maintain coherent conversations beyond 4-5 exchanges, losing important context and requiring users to repeat information.',
      language:
        'Most applications claim multilingual support but fail to provide truly localized experiences, often just translating UI strings without considering cultural context.',
      ui: 'Modern web applications often sacrifice user experience for technical simplicity, resulting in interfaces that feel cold and unengaging.',
      ai: 'Simple AI integrations often fail in production due to poor error handling, token inefficiency, and lack of user feedback during processing.',
    };

    return (
      problemStatements[analysis.primaryCategory] ||
      'Modern web applications face complex challenges that require thoughtful technical solutions.'
    );
  }

  generateArchitectureDiagram(analysis) {
    return `
\`\`\`mermaid
graph TD
    A[User Input] --> B[${analysis.primaryCategory} Processing]
    B --> C[AI Model]
    C --> D[Response Generation]
    D --> E[User Experience]
    B --> F[Memory Layer]
    F --> G[Context Preservation]
    G --> C
\`\`\`
    `;
  }

  getMainComponent(analysis) {
    const mainComponents = {
      memory: 'MemorySummarizer',
      language: 'LanguageContext',
      ui: 'ThinkingMessage',
      ai: 'ModelProvider',
    };

    return mainComponents[analysis.primaryCategory] || 'CoreComponent';
  }

  getSecondaryComponent(analysis) {
    const secondaryComponents = {
      memory: 'StructuredMemory',
      language: 'LanguageToggle',
      ui: 'AnimatedText',
      ai: 'FallbackHandler',
    };

    return secondaryComponents[analysis.primaryCategory] || 'HelperComponent';
  }

  estimateReadingTime(analysis) {
    // Rough estimate based on commits and complexity
    const baseTime = 8; // 8 minutes base
    const complexityMultiplier =
      analysis.complexity === 'high'
        ? 1.5
        : analysis.complexity === 'medium'
          ? 1.2
          : 1.0;
    const commitMultiplier = Math.min(analysis.commits.length * 0.5, 3);

    return Math.round((baseTime + commitMultiplier) * complexityMultiplier);
  }

  generateFilename(postType, analysis) {
    const date = new Date().toISOString().split('T')[0];
    const categorySlug = analysis.primaryCategory;
    return `${date}-${postType}-${categorySlug}.md`;
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const postType = args[0] || 'technical-deep-dive';
  const commitRange = args[1] || 'HEAD~10..HEAD';

  console.log('🚀 Blog Post Generator');
  console.log('======================');
  console.log(`Post Type: ${postType}`);
  console.log(`Commit Range: ${commitRange}`);
  console.log('');

  try {
    const generator = new BlogPostGenerator();
    const filepath = await generator.generatePost(postType, commitRange);
    console.log('');
    console.log('✨ Draft ready for review!');
    console.log(`Edit with: code ${filepath}`);
  } catch (error) {
    console.error('❌ Generation failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { BlogPostGenerator };
