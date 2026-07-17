package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/KhanitthaK/feedme-backend-service/internal/domain"
	"github.com/KhanitthaK/feedme-backend-service/internal/usecase"
)

func main() {
	writer := func(line string) {
		fmt.Fprintln(os.Stdout, line)
	}

	controller := usecase.NewController(10*time.Second, time.Now, writer)
	printHelp()

	scanner := bufio.NewScanner(os.Stdin)
	for {
		if !scanner.Scan() {
			return
		}
		cmd := normalize(scanner.Text())

		switch cmd {
		case "", "help":
			printHelp()
		case "normal", "newnormal", "neworder", "new":
			controller.NewOrder(false)
		case "vip", "newvip":
			controller.NewOrder(true)
		case "+bot", "addbot", "bot+":
			controller.AddBot()
		case "-bot", "removebot", "bot-":
			controller.RemoveBot()
		case "status":
			pending, completed, bots := controller.Snapshot()
			fmt.Printf("[%s] STATUS: bots=%d pending=%v complete=%v\n", time.Now().Format("15:04:05"), bots, orderIDs(pending), orderIDs(completed))
		case "exit", "quit":
			fmt.Printf("[%s] Exit\n", time.Now().Format("15:04:05"))
			return
		default:
			fmt.Printf("[%s] Unknown command: %s\n", time.Now().Format("15:04:05"), cmd)
		}
	}
}

func normalize(in string) string {
	lower := strings.ToLower(strings.TrimSpace(in))
	replacer := strings.NewReplacer(" ", "", "\t", "")
	return replacer.Replace(lower)
}

func orderIDs(orders []domain.Order) []int {
	ids := make([]int, len(orders))
	for i, order := range orders {
		ids[i] = order.ID
	}
	return ids
}

func printHelp() {
	fmt.Printf("[%s] Commands: normal | vip | +bot | -bot | status | help | exit\n", time.Now().Format("15:04:05"))
}
