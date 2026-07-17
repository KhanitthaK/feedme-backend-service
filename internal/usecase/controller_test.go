package usecase

import (
	"testing"
	"time"

	"github.com/KhanitthaK/feedme-backend-service/internal/domain"
)

func TestNewOrderPrioritizesVIP(t *testing.T) {
	controller := NewController(time.Second, nil, nil)

	controller.NewOrder(false) // #1 normal
	controller.NewOrder(false) // #2 normal
	controller.NewOrder(true)  // #3 vip
	controller.NewOrder(true)  // #4 vip
	controller.NewOrder(false) // #5 normal

	pending, _, _ := controller.Snapshot()
	got := ids(pending)
	want := []int{3, 4, 1, 2, 5}
	assertEqualIDs(t, got, want)
}

func TestRemoveBusyBotRequeuesOrderByPriority(t *testing.T) {
	controller := NewController(2*time.Second, nil, nil)

	controller.NewOrder(true)  // #1 vip
	controller.NewOrder(true)  // #2 vip
	controller.NewOrder(false) // #3 normal

	controller.AddBot()
	time.Sleep(20 * time.Millisecond)
	controller.RemoveBot()

	pending, completed, bots := controller.Snapshot()
	if bots != 0 {
		t.Fatalf("expected 0 bots, got %d", bots)
	}
	if len(completed) != 0 {
		t.Fatalf("expected no completed orders, got %d", len(completed))
	}

	got := ids(pending)
	want := []int{1, 2, 3}
	assertEqualIDs(t, got, want)
}

func TestBotCompletesOrder(t *testing.T) {
	controller := NewController(40*time.Millisecond, nil, nil)
	controller.NewOrder(false)
	controller.AddBot()

	time.Sleep(120 * time.Millisecond)
	pending, completed, bots := controller.Snapshot()

	if bots != 1 {
		t.Fatalf("expected 1 bot, got %d", bots)
	}
	if len(pending) != 0 {
		t.Fatalf("expected 0 pending, got %d", len(pending))
	}
	if got := ids(completed); len(got) != 1 || got[0] != 1 {
		t.Fatalf("expected completed order [1], got %v", got)
	}
}

func ids(orders []domain.Order) []int {
	out := make([]int, len(orders))
	for i, order := range orders {
		out[i] = order.ID
	}
	return out
}

func assertEqualIDs(t *testing.T, got, want []int) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("len mismatch got=%v want=%v", got, want)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("mismatch at %d got=%v want=%v", i, got, want)
		}
	}
}
