// Command seed prepares the offline CLI demo workspace with realistic dispute
// data. It targets the shared "demo" merchant, exactly like the original script.
package main

import (
	"context"
	"log"

	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/demo"
	"github.com/Ejicode/dispute-autopilot/internal/runtime"
	"github.com/Ejicode/dispute-autopilot/internal/scope"
)

func main() {
	config.LoadEnvFiles()
	mode := config.MustApplicationMode()
	ctx, err := scope.With(context.Background(), "demo", mode, nil)
	if err != nil {
		log.Fatalf("seed: %v", err)
	}
	if err := runtime.RequireDemo(ctx); err != nil {
		log.Fatalf("seed: %v", err)
	}
	if err := demo.SeedWorkspace(ctx); err != nil {
		log.Fatalf("seed failed: %v", err)
	}
	log.Print("Seeding complete: 3 active disputes, 3 orders, 8 vault items created.")
}
