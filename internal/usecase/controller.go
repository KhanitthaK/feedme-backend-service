package usecase

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/KhanitthaK/feedme-backend-service/internal/domain"
)

type eventWriter func(string)

type bot struct {
	id     int
	busy   bool
	order  *domain.Order
	cancel context.CancelFunc
}

type Controller struct {
	mu                 sync.Mutex
	nextOrderID        int
	nextBotID          int
	pending            []*domain.Order
	completed          []*domain.Order
	bots               []*bot
	processingDuration time.Duration
	now                func() time.Time
	writeEvent         eventWriter
}

func NewController(processingDuration time.Duration, now func() time.Time, writer eventWriter) *Controller {
	if processingDuration <= 0 {
		processingDuration = 10 * time.Second
	}
	if now == nil {
		now = time.Now
	}
	return &Controller{
		nextOrderID:        1,
		nextBotID:          1,
		processingDuration: processingDuration,
		now:                now,
		writeEvent:         writer,
	}
}

func (c *Controller) NewOrder(vip bool) *domain.Order {
	c.mu.Lock()
	defer c.mu.Unlock()

	order := &domain.Order{
		ID:     c.nextOrderID,
		VIP:    vip,
		Status: domain.StatusPending,
	}
	c.nextOrderID++
	c.insertPendingLocked(order)
	if vip {
		c.logfLocked("Created VIP order #%d", order.ID)
	} else {
		c.logfLocked("Created NORMAL order #%d", order.ID)
	}
	c.scheduleLocked()
	return order
}

func (c *Controller) AddBot() int {
	c.mu.Lock()
	defer c.mu.Unlock()

	b := &bot{id: c.nextBotID}
	c.nextBotID++
	c.bots = append(c.bots, b)
	c.logfLocked("Added bot #%d", b.id)
	c.scheduleLocked()
	return b.id
}

func (c *Controller) RemoveBot() (int, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if len(c.bots) == 0 {
		c.logfLocked("No bot to remove")
		return 0, false
	}

	last := len(c.bots) - 1
	b := c.bots[last]
	c.bots = c.bots[:last]

	if b.busy && b.order != nil {
		order := b.order
		order.Status = domain.StatusPending
		c.insertPendingLocked(order)
		b.busy = false
		b.order = nil
		if b.cancel != nil {
			b.cancel()
			b.cancel = nil
		}
		c.logfLocked("Removed bot #%d and returned order #%d to pending", b.id, order.ID)
		return b.id, true
	}

	if b.cancel != nil {
		b.cancel()
		b.cancel = nil
	}
	c.logfLocked("Removed idle bot #%d", b.id)
	return b.id, true
}

func (c *Controller) Snapshot() (pending []domain.Order, completed []domain.Order, activeBots int) {
	c.mu.Lock()
	defer c.mu.Unlock()

	pending = make([]domain.Order, len(c.pending))
	for i, o := range c.pending {
		pending[i] = *o
	}
	completed = make([]domain.Order, len(c.completed))
	for i, o := range c.completed {
		completed[i] = *o
	}
	return pending, completed, len(c.bots)
}

func (c *Controller) insertPendingLocked(order *domain.Order) {
	idx := len(c.pending)
	for i, existing := range c.pending {
		if order.VIP {
			if !existing.VIP || existing.ID > order.ID {
				idx = i
				break
			}
		} else {
			if !existing.VIP && existing.ID > order.ID {
				idx = i
				break
			}
		}
	}

	c.pending = append(c.pending, nil)
	copy(c.pending[idx+1:], c.pending[idx:])
	c.pending[idx] = order
}

func (c *Controller) scheduleLocked() {
	for _, b := range c.bots {
		if b.busy || len(c.pending) == 0 {
			continue
		}

		order := c.pending[0]
		c.pending = c.pending[1:]
		order.Status = domain.StatusProcessing

		ctx, cancel := context.WithCancel(context.Background())
		b.busy = true
		b.order = order
		b.cancel = cancel

		c.logfLocked("Bot #%d started order #%d", b.id, order.ID)
		go c.processOrder(ctx, b)
	}
}

func (c *Controller) processOrder(ctx context.Context, b *bot) {
	timer := time.NewTimer(c.processingDuration)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return
	case <-timer.C:
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	if !b.busy || b.order == nil {
		return
	}

	order := b.order
	order.Status = domain.StatusComplete
	c.completed = append(c.completed, order)

	b.busy = false
	b.order = nil
	b.cancel = nil

	c.logfLocked("Order #%d COMPLETE by bot #%d", order.ID, b.id)
	c.scheduleLocked()
}

func (c *Controller) logfLocked(format string, args ...any) {
	if c.writeEvent == nil {
		return
	}
	line := fmt.Sprintf("[%s] %s", c.now().Format("15:04:05"), fmt.Sprintf(format, args...))
	c.writeEvent(line)
}
