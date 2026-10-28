package httpapi

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/httpx"
	"github.com/Ejicode/dispute-autopilot/internal/store"
	"github.com/Ejicode/dispute-autopilot/internal/storefront"
	"github.com/Ejicode/dispute-autopilot/internal/types"
)

func likeArg(q string) string { return "%" + q + "%" }

func (a *API) search(w http.ResponseWriter, r *http.Request, _ *types.UserAccount) error {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(q) < 2 {
		httpx.JSON(w, http.StatusOK, map[string]any{"results": []any{}, "query": q})
		return nil
	}
	db, err := store.Merchant(r.Context())
	if err != nil {
		return err
	}
	results := []map[string]any{}
	rebuildSearchIndexes(r.Context(), db)

	like := likeArg(q)
	if rows, err := queryMaps(r.Context(), db, `SELECT id, paypal_dispute_id, transaction_id, reason, status, recommendation, amount_cents, response_deadline, created_at
		FROM disputes
		WHERE paypal_dispute_id LIKE ? OR transaction_id LIKE ? OR reason LIKE ? OR status LIKE ? OR recommendation LIKE ?
		LIMIT 6`, like, like, like, like, like); err != nil {
		return err
	} else {
		for _, d := range rows {
			status := stringValue(d["status"])
			badgeColor := "blue"
			if status == string(types.StatusRequiredAction) {
				badgeColor = "amber"
			} else if status == string(types.StatusResolved) {
				badgeColor = "emerald"
			}
			txnID := stringValue(d["transaction_id"])
			sub := strings.ReplaceAll(stringValue(d["reason"]), "_", " ") + " · $" + formatCents(intValue(d["amount_cents"]))
			if txnID != "" {
				sub = "Txn: " + txnID + " · " + sub
			}
			results = append(results, map[string]any{
				"type":       "dispute",
				"id":         d["id"],
				"title":      d["paypal_dispute_id"],
				"subtitle":   sub,
				"badge":      d["status"],
				"badgeColor": badgeColor,
				"href":       "/case/" + stringValue(d["id"]),
				"icon":       "shield",
			})
		}
	}

	if rows, err := queryMaps(r.Context(), db, `SELECT id, order_number, buyer_name, buyer_email, tracking_number, paypal_order_id, items, delivery_status, total_cents, created_at
		FROM demo_orders
		WHERE order_number LIKE ? OR buyer_name LIKE ? OR buyer_email LIKE ? OR paypal_order_id LIKE ? OR tracking_number LIKE ? OR items LIKE ? OR shipping_address LIKE ?
		LIMIT 6`, like, like, like, like, like, like, like); err != nil {
		return err
	} else {
		for _, o := range rows {
			deliveryStatus := stringValue(o["delivery_status"])
			badgeColor := "blue"
			if deliveryStatus == "DELIVERED" {
				badgeColor = "emerald"
			}
			sub := strings.ReplaceAll(deliveryStatus, "_", " ") + " · $" + formatCents(intValue(o["total_cents"]))
			if track := stringValue(o["tracking_number"]); track != "" {
				sub += " · " + track
			}
			results = append(results, map[string]any{
				"type":       "order",
				"id":         o["id"],
				"title":      stringValue(o["order_number"]) + " — " + stringValue(o["buyer_name"]),
				"subtitle":   sub,
				"badge":      o["delivery_status"],
				"badgeColor": badgeColor,
				"href":       "/storefront",
				"icon":       "package",
			})
		}
	}

	qLower := strings.ToLower(q)
	matched := 0
	for _, p := range storefront.Products() {
		if matched >= 4 {
			break
		}
		name := strings.ToLower(stringValue(p["name"]))
		category := strings.ToLower(stringValue(p["category"]))
		brand := strings.ToLower(stringValue(p["brand"]))
		sku := strings.ToLower(stringValue(p["sku"]))
		if strings.Contains(name, qLower) || strings.Contains(category, qLower) ||
			strings.Contains(brand, qLower) || strings.Contains(sku, qLower) {
			matched++
			results = append(results, map[string]any{
				"type":       "product",
				"id":         p["id"],
				"title":      p["name"],
				"subtitle":   stringValue(p["category"]) + " · $" + formatCents(intValue(p["price_cents"])),
				"badge":      p["category"],
				"badgeColor": "slate",
				"href":       "/storefront",
				"icon":       "shopping",
				"image":      p["image_url"],
			})
		}
	}

	if rows, err := queryMaps(r.Context(), db, `SELECT id, dispute_id, evidence_type, title, source, captured_at
		FROM evidence_items
		WHERE title LIKE ? OR evidence_type LIKE ? OR source LIKE ?
		LIMIT 3`, like, like, like); err != nil {
		return err
	} else {
		for _, e := range rows {
			href := "/storefront"
			if stringValue(e["dispute_id"]) != "" {
				href = "/case/" + stringValue(e["dispute_id"])
			}
			results = append(results, map[string]any{
				"type":       "evidence",
				"id":         e["id"],
				"title":      e["title"],
				"subtitle":   strings.ReplaceAll(stringValue(e["evidence_type"]), "_", " ") + " · " + stringValue(e["source"]),
				"badge":      e["evidence_type"],
				"badgeColor": "violet",
				"href":       href,
				"icon":       "file",
			})
		}
	}

	total := len(results)
	if total > 12 {
		results = results[:12]
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"results": results, "query": q, "total": total})
	return nil
}

// rebuildSearchIndexes mirrors the best-effort FTS rebuild the API performed on
// first search after boot. Search correctness never depends on it.
func rebuildSearchIndexes(ctx context.Context, db *store.Store) {
	if count, err := queryCount(ctx, db, "SELECT count(*) FROM disputes_fts"); err == nil && count == 0 {
		if _, err := db.Exec(ctx, "INSERT INTO disputes_fts(disputes_fts) VALUES('rebuild')"); err != nil {
			rebuildDisputesFTS(ctx, db)
		}
	}
	if count, err := queryCount(ctx, db, "SELECT count(*) FROM orders_fts"); err == nil && count == 0 {
		if _, err := db.Exec(ctx, "INSERT INTO orders_fts(orders_fts) VALUES('rebuild')"); err != nil {
			rebuildOrdersFTS(ctx, db)
		}
	}
}

func rebuildDisputesFTS(ctx context.Context, db *store.Store) {
	if _, err := db.Exec(ctx, "DELETE FROM disputes_fts"); err != nil {
		return
	}
	rows, err := queryMaps(ctx, db, "SELECT rowid, id, paypal_dispute_id, reason, status, recommendation FROM disputes")
	if err != nil {
		return
	}
	for _, d := range rows {
		_, _ = db.Exec(ctx, "INSERT INTO disputes_fts(rowid, id, paypal_dispute_id, reason, status, recommendation, amount_cents) VALUES (?,?,?,?,?,?,0)",
			d["rowid"], d["id"], d["paypal_dispute_id"], d["reason"], d["status"], d["recommendation"])
	}
}

func rebuildOrdersFTS(ctx context.Context, db *store.Store) {
	if _, err := db.Exec(ctx, "DELETE FROM orders_fts"); err != nil {
		return
	}
	rows, err := queryMaps(ctx, db, "SELECT rowid, id, order_number, buyer_name, buyer_email, shipping_address, delivery_status FROM demo_orders")
	if err != nil {
		return
	}
	for _, o := range rows {
		_, _ = db.Exec(ctx, "INSERT INTO orders_fts(rowid, id, order_number, buyer_name, buyer_email, shipping_address, delivery_status) VALUES (?,?,?,?,?,?,?)",
			o["rowid"], o["id"], o["order_number"], o["buyer_name"], o["buyer_email"], o["shipping_address"], o["delivery_status"])
	}
}

func formatCents(cents int64) string { return fmt.Sprintf("%.2f", float64(cents)/100) }

func queryCount(ctx context.Context, db *store.Store, query string, args ...any) (int64, error) {
	var count int64
	if err := db.QueryRow(ctx, query, args...).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

func isoDay(t time.Time) string { return t.UTC().Format("2006-01-02") }

func (a *API) analytics(w http.ResponseWriter, r *http.Request, _ *types.UserAccount) error {
	db, err := store.Merchant(r.Context())
	if err != nil {
		return err
	}
	disputes, err := queryMaps(r.Context(), db, "SELECT * FROM disputes ORDER BY created_at DESC")
	if err != nil {
		return err
	}
	orders, err := queryMaps(r.Context(), db, "SELECT * FROM demo_orders ORDER BY created_at DESC")
	if err != nil {
		return err
	}
	evidenceCount, err := queryCount(r.Context(), db, "SELECT count(*) as count FROM evidence_items")
	if err != nil {
		return err
	}
	users, err := queryMaps(r.Context(), db, "SELECT * FROM users ORDER BY created_at DESC")
	if err != nil {
		return err
	}

	now := config.NowMillis()
	in48Hours := now + 48*3600*1000

	var totalAtRiskCents, recoveredCents int64
	var expiring48hCount, requiredActionCount, wonCount int
	for _, d := range disputes {
		status := stringValue(d["status"])
		if status == string(types.StatusRequiredAction) || status == string(types.StatusUnderReview) {
			totalAtRiskCents += intValue(d["amount_cents"])
			requiredActionCount++
			deadline := parseISOMillis(stringValue(d["response_deadline"]))
			if deadline != 0 && deadline <= in48Hours && deadline >= now {
				expiring48hCount++
			}
		} else if status == string(types.StatusResolved) {
			recoveredCents += intValue(d["amount_cents"])
			if stringValue(d["outcome"]) == "WON" || stringValue(d["recommendation"]) == string(types.RecommendFight) {
				wonCount++
			}
		}
	}

	resolvedCount := 0
	for _, d := range disputes {
		if stringValue(d["status"]) == string(types.StatusResolved) {
			resolvedCount++
		}
	}
	winRate := 0
	switch {
	case resolvedCount > 0:
		winRate = int(math.Round(float64(wonCount) / float64(resolvedCount) * 100))
	case len(disputes) > 0:
		winRate = int(math.Round(float64(len(disputes)-requiredActionCount) / float64(len(disputes)) * 100))
	}

	avgResponseHours := 0.0
	resolvedHours := 0.0
	resolvedWithTimes := 0
	for _, d := range disputes {
		if stringValue(d["status"]) == string(types.StatusResolved) && stringValue(d["created_at"]) != "" && stringValue(d["updated_at"]) != "" {
			updated := parseISOMillis(stringValue(d["updated_at"]))
			created := parseISOMillis(stringValue(d["created_at"]))
			resolvedHours += float64(updated-created) / (1000 * 60 * 60)
			resolvedWithTimes++
		}
	}
	if resolvedWithTimes > 0 {
		avgResponseHours = math.Round(resolvedHours/float64(resolvedWithTimes)*10) / 10
	} else {
		activeHours := 0.0
		activeTimes := 0
		for _, d := range disputes {
			if stringValue(d["created_at"]) != "" {
				activeHours += float64(now-parseISOMillis(stringValue(d["created_at"]))) / (1000 * 60 * 60)
				activeTimes++
			}
		}
		if activeTimes > 0 {
			avgResponseHours = math.Round(activeHours/float64(activeTimes)*10) / 10
		}
	}

	var totalProtectedCents int64
	for _, o := range orders {
		totalProtectedCents += intValue(o["total_cents"])
	}

	distinctCustomers, err := queryCount(r.Context(), db, "SELECT count(DISTINCT buyer_email) as count FROM demo_orders")
	if err != nil {
		return err
	}
	orderCount := len(orders)

	// Category breakdown preserving first-appearance order (matches object key order).
	reasonOrder := []string{}
	reasonCount := map[string]int{}
	reasonAmount := map[string]int64{}
	for _, d := range disputes {
		reason := stringValue(d["reason"])
		if _, seen := reasonCount[reason]; !seen {
			reasonOrder = append(reasonOrder, reason)
		}
		reasonCount[reason]++
		reasonAmount[reason] += intValue(d["amount_cents"])
	}

	colorPalette := []string{"#0070BA", "#003087", "#009CDE", "#FFC439", "#475569"}
	labels := map[string]string{
		"MERCHANDISE_OR_SERVICE_NOT_RECEIVED":     "Item Not Received (INR)",
		"MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED": "Not As Described (SNAD)",
		"UNAUTHORISED":          "Unauthorised Transaction",
		"INCORRECT_AMOUNT":      "Incorrect Amount Charged",
		"DUPLICATE_TRANSACTION": "Duplicate Charge",
	}

	donutCategories := []map[string]any{}
	for idx, reason := range reasonOrder {
		name, ok := labels[reason]
		if !ok {
			name = strings.ReplaceAll(reason, "_", " ")
		}
		totalCount := len(disputes)
		if totalCount == 0 {
			totalCount = 1
		}
		donutCategories = append(donutCategories, map[string]any{
			"reason":     reason,
			"name":       name,
			"value":      reasonCount[reason],
			"amount":     float64(reasonAmount[reason]) / 100,
			"percentage": int(math.Round(float64(reasonCount[reason]) / float64(totalCount) * 100)),
			"color":      colorPalette[idx%len(colorPalette)],
		})
	}
	if len(donutCategories) == 0 {
		donutCategories = append(donutCategories, map[string]any{
			"reason": "NO_DISPUTES", "name": "No Disputes Yet", "value": 1, "amount": 0, "percentage": 100, "color": "#0070BA",
		})
	}

	nowDate := time.Now()
	last8Days := make([]struct {
		label    string
		fullDate string
	}, 0, 8)
	for i := 0; i < 8; i++ {
		d := nowDate.AddDate(0, 0, -(7 - i))
		last8Days = append(last8Days, struct {
			label    string
			fullDate string
		}{label: d.Format("Jan 2"), fullDate: isoDay(d)})
	}

	cumulativeProtected := 0.0
	cumulativeDisputed := 0.0
	wavePoints := []map[string]any{}
	for _, day := range last8Days {
		for _, o := range orders {
			if strings.HasPrefix(stringValue(o["created_at"]), day.fullDate) {
				cumulativeProtected += float64(intValue(o["total_cents"])) / 100
			}
		}
		for _, d := range disputes {
			if strings.HasPrefix(stringValue(d["created_at"]), day.fullDate) {
				cumulativeDisputed += float64(intValue(d["amount_cents"])) / 100
			}
		}
		wavePoints = append(wavePoints, map[string]any{
			"date":            day.label,
			"disputed":        math.Round(cumulativeDisputed),
			"protectedVolume": math.Round(cumulativeProtected),
			"atRisk":          math.Round(float64(totalAtRiskCents) / 100),
		})
	}

	today := time.Now()
	dayOfWeek := int(today.Weekday())
	mondayOffset := 1 - dayOfWeek
	if dayOfWeek == 0 {
		mondayOffset = -6
	}
	monday := today.AddDate(0, 0, mondayOffset)
	todayISO := isoDay(today)
	dayNames := []string{"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"}
	calendarDays := []map[string]any{}
	activeDayIdx := -1
	for i := 0; i < 7; i++ {
		d := monday.AddDate(0, 0, i)
		fullDate := isoDay(d)
		isToday := fullDate == todayISO
		disputeCount := 0
		for _, disp := range disputes {
			if strings.HasPrefix(stringValue(disp["response_deadline"]), fullDate) {
				disputeCount++
			}
		}
		if isToday {
			activeDayIdx = i
		}
		calendarDays = append(calendarDays, map[string]any{
			"dayName":      dayNames[int(d.Weekday())],
			"dateNumber":   d.Day(),
			"fullDate":     fullDate,
			"isToday":      isToday,
			"disputeCount": disputeCount,
		})
	}
	monthLabel := today.Format("January 2006")
	if activeDayIdx < 0 {
		activeDayIdx = 3
	}

	primaryStoreName := "Your Store"
	if len(users) > 0 {
		if name := stringValue(users[0]["store_name"]); name != "" {
			primaryStoreName = name
		}
	}
	totalRequired := int64(len(disputes)) * 3
	if totalRequired == 0 {
		totalRequired = 1
	}
	coverageRate := int(math.Round(float64(evidenceCount) / float64(totalRequired) * 100))
	if coverageRate > 100 {
		coverageRate = 100
	}
	orderCoverage := 0
	if orderCount > 0 {
		orderCoverage = 100
	}
	podCoverage := int(math.Round(float64(coverageRate) * 0.95))
	if podCoverage > 100 {
		podCoverage = 100
	}
	storeBreakdowns := []map[string]any{
		{"storeName": primaryStoreName + " / Order Payment Receipts", "percentage": orderCoverage, "count": evidenceCount, "color": "#0070BA"},
		{"storeName": primaryStoreName + " / Carrier Tracking", "percentage": orderCoverage, "count": orderCount, "color": "#003087"},
		{"storeName": primaryStoreName + " / Proof of Delivery", "percentage": podCoverage, "count": evidenceCount, "color": "#009CDE"},
	}

	httpx.JSON(w, http.StatusOK, map[string]any{
		"kpis": map[string]any{
			"customerCount":       distinctCustomers,
			"orderCount":          orderCount,
			"totalAtRiskCents":    totalAtRiskCents,
			"recoveredCents":      recoveredCents,
			"expiring48hCount":    expiring48hCount,
			"requiredActionCount": requiredActionCount,
			"totalDisputes":       len(disputes),
			"evidenceCount":       evidenceCount,
			"coverageRate":        coverageRate,
			"winRate":             winRate,
			"avgResponseHours":    avgResponseHours,
			"totalProtectedCents": totalProtectedCents,
		},
		"donutCategories": donutCategories,
		"wavePoints":      wavePoints,
		"calendar": map[string]any{
			"monthLabel":   monthLabel,
			"days":         calendarDays,
			"activeDayIdx": activeDayIdx,
		},
		"storeBreakdowns": storeBreakdowns,
		"merchantCount":   len(users),
	})
	return nil
}

func (a *API) vaultList(w http.ResponseWriter, r *http.Request, _ *types.UserAccount) error {
	db, err := store.Merchant(r.Context())
	if err != nil {
		return err
	}
	items, err := queryMaps(r.Context(), db, `SELECT id, dispute_id, order_id, evidence_type, title, source, content, sha256_hash, captured_at
		FROM evidence_items
		ORDER BY captured_at DESC`)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"items": items,
		"count": len(items),
	})
	return nil
}
