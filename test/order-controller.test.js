'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { OrderController, PROCESSING_MS } = require('../src/order-controller');

class FakeClock {
  constructor() {
    this.time = 0;
    this.nextId = 1;
    this.timers = new Map();
  }

  now() { return this.time; }

  setTimeout(callback, delay) {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + delay, callback });
    return id;
  }

  clearTimeout(id) { this.timers.delete(id); }

  advance(ms) {
    const end = this.time + ms;
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= end)
        .sort(([aId, a], [bId, b]) => a.at - b.at || aId - bId)[0];
      if (!due) break;
      const [id, timer] = due;
      this.timers.delete(id);
      this.time = timer.at;
      timer.callback();
    }
    this.time = end;
  }
}

function setup() {
  const clock = new FakeClock();
  const events = [];
  const controller = new OrderController({ clock, onEvent: (event) => events.push(event) });
  return { clock, events, controller };
}

test('VIP orders lead pending queue in FIFO order; numbers are unique and increasing', () => {
  const { controller } = setup();
  assert.equal(controller.addOrder('NORMAL'), 1);
  assert.equal(controller.addOrder('VIP'), 2);
  assert.equal(controller.addOrder('NORMAL'), 3);
  assert.equal(controller.addOrder('VIP'), 4);
  assert.deepEqual(controller.getState().pending.map((order) => order.id), [2, 4, 1, 3]);
  assert.throws(() => controller.addOrder('OTHER'), TypeError);
  assert.equal(controller.addOrder('NORMAL'), 5);
});

test('a bot completes exactly after ten seconds and continues with the next order', () => {
  const { clock, events, controller } = setup();
  controller.addOrder('NORMAL');
  controller.addOrder('NORMAL');
  controller.addBot();
  assert.deepEqual(controller.getState().processing.map(({ order }) => order.id), [1]);
  clock.advance(PROCESSING_MS - 1);
  assert.equal(controller.getState().complete.length, 0);
  clock.advance(1);
  assert.deepEqual(controller.getState().complete.map((order) => order.id), [1]);
  assert.deepEqual(controller.getState().processing.map(({ order }) => order.id), [2]);
  clock.advance(PROCESSING_MS);
  assert.deepEqual(controller.getState().complete.map((order) => order.id), [1, 2]);
  assert.deepEqual(controller.getState().bots, [{ id: 1, status: 'IDLE' }]);
  assert.deepEqual(events.filter((event) => event.type === 'order-completed').map((event) => event.at), [10_000, 20_000]);
});

test('an idle bot immediately picks up a new order', () => {
  const { controller } = setup();
  controller.addBot();
  assert.equal(controller.getState().bots[0].status, 'IDLE');
  controller.addOrder('VIP');
  assert.equal(controller.getState().pending.length, 0);
  assert.equal(controller.getState().processing[0].order.id, 1);
});

test('multiple bots process one order each and take priority in dispatch order', () => {
  const { controller, clock } = setup();
  controller.addOrder('NORMAL');
  controller.addOrder('VIP');
  controller.addOrder('VIP');
  controller.addBot();
  controller.addBot();
  assert.deepEqual(controller.getState().processing.map(({ order }) => order.id), [2, 3]);
  clock.advance(PROCESSING_MS);
  assert.deepEqual(controller.getState().processing.map(({ order }) => order.id), [1]);
  assert.equal(controller.getState().bots[1].status, 'IDLE');
});

test('removing newest busy bot cancels its timer and restores its original queue place', () => {
  const { controller, clock, events } = setup();
  controller.addOrder('NORMAL'); // #1
  controller.addOrder('NORMAL'); // #2
  controller.addBot(); // #1 takes #1
  controller.addBot(); // #2 takes #2
  controller.addOrder('VIP'); // #3
  controller.addOrder('NORMAL'); // #4
  clock.advance(5_000);
  assert.equal(controller.removeBot(), 2);
  assert.deepEqual(controller.getState().pending.map((order) => order.id), [3, 2, 4]);
  clock.advance(5_000);
  assert.deepEqual(controller.getState().complete.map((order) => order.id), [1]);
  assert.equal(controller.getState().processing[0].order.id, 3);
  clock.advance(20_000);
  assert.deepEqual(controller.getState().complete.map((order) => order.id), [1, 3, 2]);
  assert.equal(events.some((event) => event.type === 'order-completed' && event.order.id === 2), true);
  assert.equal(controller.removeBot(), 1);
  assert.equal(controller.removeBot(), null);
  assert.deepEqual(controller.getState().pending.map((order) => order.id), [4]);
});

test('a canceled order requires a full ten seconds when another bot later picks it up', () => {
  const { controller, clock } = setup();
  controller.addOrder('VIP');
  controller.addBot();
  clock.advance(9_000);
  controller.removeBot();
  assert.equal(controller.getState().pending[0].id, 1);
  controller.addBot();
  clock.advance(1_000);
  assert.equal(controller.getState().complete.length, 0);
  clock.advance(9_000);
  assert.equal(controller.getState().complete[0].id, 1);
});
