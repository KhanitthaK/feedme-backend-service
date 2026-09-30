'use strict';

const PROCESSING_MS = 10_000;

class OrderController {
  constructor({ clock = globalThis, onEvent = () => {} } = {}) {
    this.clock = clock;
    this.onEvent = onEvent;
    this.nextOrderId = 1;
    this.nextBotId = 1;
    this.pending = [];
    this.complete = [];
    this.bots = [];
  }

  addOrder(type) {
    if (type !== 'VIP' && type !== 'NORMAL') {
      throw new TypeError('Order type must be VIP or NORMAL');
    }

    const order = { id: this.nextOrderId++, type, status: 'PENDING' };
    this._enqueue(order);
    this._emit('order-created', { order: { ...order } });
    this._dispatch();
    return order.id;
  }

  addBot() {
    const bot = { id: this.nextBotId++, order: null, timer: null };
    this.bots.push(bot);
    this._emit('bot-created', { botId: bot.id });
    this._dispatch();
    return bot.id;
  }

  removeBot() {
    const bot = this.bots.pop();
    if (!bot) return null;

    if (bot.timer !== null) this.clock.clearTimeout(bot.timer);
    if (bot.order) {
      const order = bot.order;
      bot.order = null;
      order.status = 'PENDING';
      this._enqueue(order);
      this._emit('order-returned', { botId: bot.id, order: { ...order } });
    }
    this._emit('bot-removed', { botId: bot.id });
    this._dispatch();
    return bot.id;
  }

  getState() {
    return {
      pending: this.pending.map((order) => ({ ...order })),
      processing: this.bots.filter((bot) => bot.order).map((bot) => ({
        botId: bot.id,
        order: { ...bot.order },
      })),
      complete: this.complete.map((order) => ({ ...order })),
      bots: this.bots.map((bot) => ({
        id: bot.id,
        status: bot.order ? 'BUSY' : 'IDLE',
      })),
    };
  }

  shutdown() {
    for (const bot of this.bots) {
      if (bot.timer !== null) this.clock.clearTimeout(bot.timer);
    }
  }

  _enqueue(order) {
    this.pending.push(order);
    // The order number preserves each customer's original place within a tier.
    this.pending.sort((a, b) =>
      (a.type === 'VIP' ? 0 : 1) - (b.type === 'VIP' ? 0 : 1) || a.id - b.id);
  }

  _dispatch() {
    for (const bot of this.bots) {
      if (bot.order || this.pending.length === 0) continue;

      const order = this.pending.shift();
      order.status = 'PROCESSING';
      bot.order = order;
      bot.timer = this.clock.setTimeout(() => this._finish(bot, order), PROCESSING_MS);
      this._emit('order-started', { botId: bot.id, order: { ...order } });
    }
  }

  _finish(bot, order) {
    // Also guard against an already queued callback after a bot is removed.
    if (!this.bots.includes(bot) || bot.order !== order) return;
    bot.timer = null;
    bot.order = null;
    order.status = 'COMPLETE';
    this.complete.push(order);
    this._emit('order-completed', { botId: bot.id, order: { ...order } });
    this._dispatch();
    if (!bot.order) this._emit('bot-idle', { botId: bot.id });
  }

  _emit(type, data) {
    this.onEvent({ type, at: this.clock.now ? this.clock.now() : Date.now(), ...data });
  }
}

module.exports = { OrderController, PROCESSING_MS };
