package rag

import (
	"context"
	"strings"
	"testing"
)

func TestStaticCorpusRetrieve(t *testing.T) {
	ctx := context.Background()

	// Test INR policy retrieval
	res, err := Retrieve(ctx, nil, "usr_test", "What are the proof of delivery requirements for item not received?")
	if err != nil {
		t.Fatalf("Retrieve failed: %v", err)
	}
	if !strings.Contains(res.ContextText, "11.3") {
		t.Errorf("Expected reference to § 11.3 in INR retrieval, got:\n%s", res.ContextText)
	}

	// Test $750 signature threshold retrieval
	resSig, err := Retrieve(ctx, nil, "usr_test", "Does a $1240 drone dispute need a signature confirmation?")
	if err != nil {
		t.Fatalf("Retrieve failed: %v", err)
	}
	if !strings.Contains(resSig.ContextText, "750") {
		t.Errorf("Expected reference to $750 threshold in signature query, got:\n%s", resSig.ContextText)
	}

	// Test hackathon pitch retrieval
	resPitch, err := Retrieve(ctx, nil, "usr_test", "Why does Dispute Autopilot win the PayPal AI Hackathon?")
	if err != nil {
		t.Fatalf("Retrieve failed: %v", err)
	}
	if !strings.Contains(resPitch.ContextText, "Standout") && !strings.Contains(resPitch.ContextText, "Architecture") && !strings.Contains(resPitch.ContextText, "Dispute Autopilot") {
		t.Errorf("Expected reference to Standout features or Architecture in pitch query, got:\n%s", resPitch.ContextText)
	}
}
