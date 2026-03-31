#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';

const CONFIG_PATHS: Record<string, Record<string, string>> = {
  'Claude Desktop': {
    darwin: path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'Claude',
      'claude_desktop_config.json'
    ),
    win32: path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json'),
    linux: path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json'),
  },
  'Claude Code': {
    darwin: path.join(os.homedir(), '.claude', 'settings.json'),
    win32: path.join(os.homedir(), '.claude', 'settings.json'),
    linux: path.join(os.homedir(), '.claude', 'settings.json'),
  },
  Cursor: {
    darwin: path.join(os.homedir(), '.cursor', 'mcp.json'),
    win32: path.join(os.homedir(), '.cursor', 'mcp.json'),
    linux: path.join(os.homedir(), '.cursor', 'mcp.json'),
  },
  Windsurf: {
    darwin: path.join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json'),
    win32: path.join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json'),
    linux: path.join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json'),
  },
};

interface ServerConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

function detectNvmPath(): { isNvm: boolean; nodePath: string | null; npxPath: string | null } {
  const nodePath = process.execPath;
  const isNvm = nodePath.includes('.nvm/versions/node');

  if (isNvm) {
    const nodeDir = path.dirname(nodePath);
    const npxPath = path.join(nodeDir, 'npx');
    return { isNvm: true, nodePath: nodeDir, npxPath };
  }

  return { isNvm: false, nodePath: null, npxPath: null };
}

function getIndigoServerConfig(): ServerConfig {
  const { isNvm, nodePath, npxPath } = detectNvmPath();

  if (isNvm && npxPath && nodePath) {
    // nvm detected - use full paths
    return {
      command: npxPath,
      args: ['-y', '@indigoprotocol/indigo-mcp'],
      env: {
        PATH: `${nodePath}:/usr/local/bin:/usr/bin:/bin`,
        INDEXER_URL: 'https://analytics.indigoprotocol.io/api/v1',
        BLOCKFROST_API_KEY: '',
      },
    };
  }

  // Standard config
  return {
    command: 'npx',
    args: ['-y', '@indigoprotocol/indigo-mcp'],
    env: {
      INDEXER_URL: 'https://analytics.indigoprotocol.io/api/v1',
      BLOCKFROST_API_KEY: '',
    },
  };
}

function createReadlineInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim());
    });
  });
}

function selectOption(rl: readline.Interface, prompt: string, options: string[]): Promise<string> {
  return new Promise((resolve) => {
    console.log(`\n${prompt}`);
    options.forEach((opt, i) => console.log(`  ${i + 1}. ${opt}`));
    rl.question('\nEnter number: ', (answer) => {
      const index = parseInt(answer.trim()) - 1;
      if (index >= 0 && index < options.length) {
        resolve(options[index]);
      } else {
        console.log('Invalid selection, using first option.');
        resolve(options[0]);
      }
    });
  });
}

function readConfig(configPath: string): Record<string, unknown> {
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(content);
    }
  } catch {
    // File doesn't exist or is invalid JSON
  }
  return {};
}

function writeConfig(configPath: string, config: Record<string, unknown>): void {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

const BANNER = `
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   ██╗███╗   ██╗██████╗ ██╗ ██████╗  ██████╗                   ║
║   ██║████╗  ██║██╔══██╗██║██╔════╝ ██╔═══██╗                  ║
║   ██║██╔██╗ ██║██║  ██║██║██║  ███╗██║   ██║                  ║
║   ██║██║╚██╗██║██║  ██║██║██║   ██║██║   ██║                  ║
║   ██║██║ ╚████║██████╔╝██║╚██████╔╝╚██████╔╝                  ║
║   ╚═╝╚═╝  ╚═══╝╚═════╝ ╚═╝ ╚═════╝  ╚═════╝                   ║
║                                                               ║
║   ███╗   ███╗ ██████╗██████╗                                  ║
║   ████╗ ████║██╔════╝██╔══██╗                                 ║
║   ██╔████╔██║██║     ██████╔╝                                 ║
║   ██║╚██╔╝██║██║     ██╔═══╝                                  ║
║   ██║ ╚═╝ ██║╚██████╗██║                                      ║
║   ╚═╝     ╚═╝ ╚═════╝╚═╝                                      ║
║                                                               ║
║   60 tools for Cardano DeFi                                   ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
`;

async function main(): Promise<void> {
  console.log(BANNER);

  const rl = createReadlineInterface();
  const platform = process.platform as 'darwin' | 'win32' | 'linux';

  try {
    // Select client
    const clients = Object.keys(CONFIG_PATHS);
    const selectedClient = await selectOption(rl, 'Select your MCP client:', clients);

    // Get config path
    const configPath = CONFIG_PATHS[selectedClient][platform];
    if (!configPath) {
      console.error(`❌ Unsupported platform: ${platform}`);
      process.exit(1);
    }

    console.log(`\n📁 Config file: ${configPath}`);

    // Ask for Blockfrost API key
    console.log('\n💡 Get a free Blockfrost API key at: https://blockfrost.io/');
    const blockfrostKey = await question(
      rl,
      'Enter your Blockfrost API key (or press Enter to skip): '
    );

    // Read existing config
    const config = readConfig(configPath);

    // Ensure mcpServers exists
    if (!config.mcpServers) {
      config.mcpServers = {};
    }

    // Check for existing indigo config
    const existingServers = config.mcpServers as Record<string, any>;
    const existingIndigo = existingServers['indigo'];
    const existingKey = existingIndigo?.env?.BLOCKFROST_API_KEY;

    // Detect nvm and get appropriate config
    const { isNvm, nodePath } = detectNvmPath();
    if (isNvm) {
      console.log(`\n🔧 Detected nvm (Node path: ${nodePath})`);
      console.log('   Using full paths in config for compatibility.');
    }

    // Add indigo server
    const serverConfig = getIndigoServerConfig();
    if (blockfrostKey) {
      serverConfig.env = { ...serverConfig.env, BLOCKFROST_API_KEY: blockfrostKey };
    } else if (existingKey && existingKey !== 'your-blockfrost-project-id') {
      // Preserve existing key if user skipped
      serverConfig.env = { ...serverConfig.env, BLOCKFROST_API_KEY: existingKey };
    } else {
      serverConfig.env = { ...serverConfig.env, BLOCKFROST_API_KEY: 'your-blockfrost-project-id' };
    }

    existingServers['indigo'] = serverConfig;

    // Write config
    writeConfig(configPath, config);

    console.log(`\n✅ Added indigo server to ${selectedClient} config`);
    console.log(`   ${configPath}`);

    if (!blockfrostKey) {
      console.log('\n⚠️  Remember to add your Blockfrost API key to the config file.');
      console.log('   Read-only tools work without it, but write operations require it.');
    }

    console.log(`\n🔄 Restart ${selectedClient} to activate the changes.\n`);
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error('Setup failed:', error);
  process.exit(1);
});
