package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/Ejicode/dispute-autopilot/internal/auth"
	"github.com/Ejicode/dispute-autopilot/internal/carrier"
	"github.com/Ejicode/dispute-autopilot/internal/httpx"
	"github.com/Ejicode/dispute-autopilot/internal/runtime"
	"github.com/Ejicode/dispute-autopilot/internal/store"
	"github.com/Ejicode/dispute-autopilot/internal/storefront"
	"github.com/Ejicode/dispute-autopilot/internal/types"
)

var validMilestones = map[string]bool{
	"LABEL_CREATED":    true,
	"PICKED_UP":        true,
	"IN_TRANSIT":       true,
	"OUT_FOR_DELIVERY": true,
	"DELIVERED":        true,
}

func (a *API) checkoutList(w http.ResponseWriter, r *http.Request, _ *types.UserAccount) error {
	db, err := store.Merchant(r.Context())
	if err != nil {
		return err
	}
	orders, err := queryMaps(r.Context(), db, "SELECT * FROM demo_orders ORDER BY created_at DESC LIMIT 20")
	if err != nil {
		return err
	}
	// The checkout view consumers expect `items` as a decoded array.
	formatted := make([]map[string]any, 0, len(orders))
	for _, order := range orders {
		items := []any{}
		if text := stringValue(order["items"]); text != "" {
			var parsed []any
			if json.Unmarshal([]byte(text), &parsed) == nil {
				items = parsed
			}
		}
		order["items"] = items
		formatted = append(formatted, order)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"orders": formatted})
	return nil
}

func (a *API) checkoutCreate(w http.ResponseWriter, r *http.Request, _ *types.UserAccount) error {
	body, err := auth.ReadAuthBody(r, 32768)
	if err != nil {
		return err
	}
	result, err := storefront.Checkout(r.Context(), body)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, result)
	return nil
}

func (a *API) carrierUpdate(w http.ResponseWriter, r *http.Request, _ *types.UserAccount) error {
	if err := runtime.RequireDemo(r.Context()); err != nil {
		return err
	}
	body, err := auth.ReadAuthBody(r, 8192)
	if err != nil {
		return err
	}
	orderID, err := auth.Field(body, "order_id", 100)
	if err != nil {
		return err
	}
	var target *string
	if raw, present := body["target_status"]; present {
		value, ok := raw.(string)
		if !ok || !validMilestones[value] {
			return httpx.Errorf(http.StatusBadRequest, "Invalid target_status")
		}
		target = &value
	}
	result, err := carrier.AdvanceCarrierStatus(r.Context(), orderID, target)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, result)
	return nil
}
