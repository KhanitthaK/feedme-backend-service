#!/usr/bin/env node
'use strict';

const readline = require('node:readline');
const { OrderController } = require('./order-controller');

function timestamp(at) {
  return new Date(at).toISOString().slice(11, 19);
}

function describe(event) {
  const order = event.order;
  switch (event.type) {
    case 'order-created': return `${order.type} order #${order.id} entered PENDING`;
    case 'bot-created': return `Bot #${event.botId} created`;
    case 'order-started': return `Bot #${event.botId} started ${order.type} order #${order.id}`;
    case 'order-completed': return `Bot #${event.botId} completed ${order.type} order #${order.id} after 10 seconds`;
    case 'order-returned': return `${order.type} order #${order.id} returned to PENDING from bot #${event.botId}`;
    case 'bot-removed': return `Bot #${event.botId} removed`;
    case 'bot-idle': return `Bot #${event.botId} is IDLE`;
    default: throw new Error(`Unknown event: ${event.type}`);
  }
}

function print(message, at = Date.now()) {
  console.log(`[${timestamp(at)}] ${message}`);
}

function printState(controller) {
  const state = controller.getState();
  const orders = (list) => list.length
    ? list.map((order) => `#${order.id} ${order.type}`).join(', ')
    : '(none)';
  print(`PENDING: ${orders(state.pending)}`);
  print(`PROCESSING: ${state.processing.length
    ? state.processing.map(({ botId, order }) => `bot #${botId}: #${order.id} ${order.type}`).join(', ')
    : '(none)'}`);
  print(`COMPLETE: ${orders(state.complete)}`);
  print(`BOTS: ${state.bots.length
    ? state.bots.map((bot) => `#${bot.id} ${bot.status}`).join(', ')
    : '(none)'}`);
}

function handleCommand(line, controller) {
  const command = line.trim().toLowerCase();
  switch (command) {
    case 'normal': controller.addOrder('NORMAL'); break;
    case 'vip': controller.addOrder('VIP'); break;
    case '+':
    case 'add': controller.addBot(); break;
    case '-':
    case 'remove':
      if (controller.removeBot() === null) print('No bot to remove');
      break;
    case 'status': printState(controller); break;
    case 'help': print('Commands: normal, vip, + (add bot), - (remove newest bot), status, help, quit'); break;
    case 'quit':
    case 'exit': return false;
    case '': break;
    default: print(`Unknown command: ${line.trim()}. Type help for commands.`);
  }
  return true;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function demo(controller) {
  print('Starting order controller demo');
  controller.addOrder('NORMAL');
  controller.addOrder('NORMAL');
  controller.addOrder('VIP');
  controller.addOrder('VIP');
  printState(controller);
  controller.addBot();
  controller.addBot();
  controller.addBot();
  controller.removeBot(); // Returns the first normal order to its original queue position.
  printState(controller);
  const deadline = Date.now() + 60_000;
  while (controller.getState().complete.length < 4) {
    if (Date.now() > deadline) throw new Error('Demo timed out before all orders completed');
    await delay(50);
  }
  printState(controller);
  controller.shutdown();
}

async function main() {
  const controller = new OrderController({ onEvent: (event) => print(describe(event), event.at) });
  if (process.argv.includes('--demo')) {
    await demo(controller);
    return;
  }

  print('Order controller ready. Type help for commands.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  if (process.stdin.isTTY) rl.setPrompt('order> ');
  if (process.stdin.isTTY) rl.prompt();
  rl.on('line', (line) => {
    const keepGoing = handleCommand(line, controller);
    if (!keepGoing) rl.close();
    else if (process.stdin.isTTY) rl.prompt();
  });
  rl.on('close', () => {
    controller.shutdown();
    print('Order controller stopped');
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { handleCommand, timestamp };
