package domain

type Status string

const (
	StatusPending    Status = "PENDING"
	StatusProcessing Status = "PROCESSING"
	StatusComplete   Status = "COMPLETE"
)

type Order struct {
	ID     int
	VIP    bool
	Status Status
}
