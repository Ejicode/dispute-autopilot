// Package scope carries the server-selected merchant workspace through a request
// context. It replaces Node's AsyncLocalStorage: business data access is only
// possible once a scope is present.
package scope

import (
	"context"
	"errors"
	"regexp"

	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/types"
)

// Scope is the authenticated, server-selected merchant workspace.
type Scope struct {
	MerchantID string
	Mode       config.Mode
	User       *types.UserAccount
}

var merchantIDPattern = regexp.MustCompile(`^usr_[a-f0-9]{32}$`)

type ctxKey struct{}

// ErrNoScope indicates business data was accessed without an authenticated scope.
var ErrNoScope = errors.New("merchant context is required for business data access")

// With validates and attaches a scope to a context.
func With(ctx context.Context, merchantID string, mode config.Mode, user *types.UserAccount) (context.Context, error) {
	if !merchantIDPattern.MatchString(merchantID) && merchantID != "demo" {
		return nil, errors.New("invalid merchant workspace")
	}
	return context.WithValue(ctx, ctxKey{}, Scope{MerchantID: merchantID, Mode: mode, User: user}), nil
}

// From reads the scope from a context, failing closed when absent.
func From(ctx context.Context) (Scope, error) {
	s, ok := ctx.Value(ctxKey{}).(Scope)
	if !ok {
		return Scope{}, ErrNoScope
	}
	return s, nil
}

// MustFrom panics if no scope is present (used on server-internal paths).
func MustFrom(ctx context.Context) Scope {
	s, err := From(ctx)
	if err != nil {
		panic(err)
	}
	return s
}
