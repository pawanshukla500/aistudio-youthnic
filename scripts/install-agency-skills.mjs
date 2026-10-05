import fs from 'node:fs';
import path from 'node:path';

const skillsToInstall = [
  {
    path: 'engineering/engineering-autonomous-optimization-architect.md',
    name: 'agency-engineering-autonomous-optimization-architect',
  },
  {
    path: 'engineering/engineering-devops-automator.md',
    name: 'agency-engineering-devops-automator',
  },
  {
    path: 'engineering/engineering-database-optimizer.md',
    name: 'agency-engineering-database-optimizer',
  },
  {
    path: 'engineering/engineering-ai-data-remediation-engineer.md',
    name: 'agency-engineering-ai-data-remediation-engineer',
  },
  {
    path: 'engineering/engineering-llm-post-training-engineer.md',
    name: 'agency-engineering-llm-post-training-engineer',
  },
  {
    path: 'design/design-ui-designer.md',
    name: 'agency-design-ui-designer',
  },
  {
    path: 'design/design-ux-researcher.md',
    name: 'agency-design-ux-researcher',
  },
  {
    path: 'design/design-image-prompt-engineer.md',
    name: 'agency-design-image-prompt-engineer',
  },
  {
    path: 'specialized/agents-orchestrator.md',
    name: 'agency-specialized-agents-orchestrator',
  },
  {
    path: 'testing/testing-api-tester.md',
    name: 'agency-testing-api-tester',
  },
];

const RAW_BASE = 'https://raw.githubusercontent.com/msitarzewski/agency-agents/main/';
const GLOBAL_ROOT = 'C:/Users/Pawan Shukla/.gemini/config/skills';
const LOCAL_ROOT = path.resolve(process.cwd(), '.agents/skills');

async function install() {
  console.log(`Starting installation of ${skillsToInstall.length} agency-agents skills...`);

  for (const item of skillsToInstall) {
    const url = `${RAW_BASE}${item.path}`;
    console.log(`Fetching ${item.name} from ${url}...`);
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`Failed to fetch ${url}: ${resp.status} ${resp.statusText}`);
    }
    let content = await resp.text();

    // Adjust frontmatter name to match skill identifier if frontmatter is present
    if (content.startsWith('---')) {
      const secondDashes = content.indexOf('\n---', 3);
      if (secondDashes !== -1) {
        let frontmatter = content.slice(3, secondDashes);
        const body = content.slice(secondDashes + 4);
        
        // Replace or add name:
        if (frontmatter.includes('name:')) {
          frontmatter = frontmatter.replace(/^name:.*$/m, `name: '${item.name}'`);
        } else {
          frontmatter = `name: '${item.name}'\n` + frontmatter;
        }
        content = `---\n${frontmatter.trim()}\n---\n${body}`;
      }
    } else {
      content = `---\nname: '${item.name}'\ndescription: '${item.name}'\n---\n\n${content}`;
    }

    // Write to Global
    const globalDir = path.join(GLOBAL_ROOT, item.name);
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(path.join(globalDir, 'SKILL.md'), content, 'utf8');

    // Write to Local
    const localDir = path.join(LOCAL_ROOT, item.name);
    fs.mkdirSync(localDir, { recursive: true });
    fs.writeFileSync(path.join(localDir, 'SKILL.md'), content, 'utf8');

    console.log(`✓ Installed ${item.name} to global and local skills.`);
  }

  console.log('All skills successfully installed!');
}

install().catch((err) => {
  console.error('Installation failed:', err);
  process.exit(1);
});
