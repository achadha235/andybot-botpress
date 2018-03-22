const path = require('path');

const Botpress = require(path.join(__dirname, 'node_modules/botpress/lib/node.bundle.js')).Botpress()
const projectPath = path.resolve(__dirname)
const botfilePath = path.join(projectPath, 'botfile.js');
const botfile = require(botfilePath);
const bot = new Botpress({botfile: botfilePath});
const setup = require('./src/setup');

async function startBot () {
  await setup();
  const res = bot.start();
}

startBot()
