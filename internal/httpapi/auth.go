package httpapi

import (
	"database/sql"
	"errors"
	"net/http"
	"net/url"

	"github.com/Ejicode/dispute-autopilot/internal/auth"
	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/demo"
	"github.com/Ejicode/dispute-autopilot/internal/httpx"
	"github.com/Ejicode/dispute-autopilot/internal/scope"
	"github.com/Ejicode/dispute-autopilot/internal/store"
	"github.com/Ejicode/dispute-autopilot/internal/types"
)

func truthy(value any) bool {
	switch v := value.(type) {
	case string:
		return v != ""
	case bool:
		return v
	case float64:
		return v != 0
	case int64:
		return v != 0
	}
	return false
}

func (a *API) health(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	unavailable := func() {
		httpx.JSON(w, http.StatusServiceUnavailable, map[string]any{"status": "unavailable"})
	}
	if _, err := config.ApplicationMode(); err != nil {
		unavailable()
		return
	}
	db, err := store.Auth()
	if err != nil {
		unavailable()
		return
	}
	var one int
	if err := db.QueryRow(r.Context(), "SELECT 1").Scan(&one); err != nil {
		unavailable()
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"status": "ok"})
}

func (a *API) authSession(w http.ResponseWriter, r *http.Request) {
	user, err := auth.RequireUser(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.JSON(w, http.StatusOK, map[string]any{"user": user})
}

func (a *API) authRegister(w http.ResponseWriter, r *http.Request) {
	if err := a.register(w, r); err != nil {
		httpx.Error(w, err)
	}
}

func (a *API) register(w http.ResponseWriter, r *http.Request) error {
	if err := auth.AssertSameOrigin(r); err != nil {
		return err
	}
	body, err := httpx.ReadJSONBody(r, 8192)
	if err != nil {
		return err
	}
	email, password, err := auth.Credentials(body, true)
	if err != nil {
		return err
	}
	name, err := auth.Field(body, "name", 100)
	if err != nil {
		return err
	}
	storeName, err := auth.Field(body, "store_name", 120)
	if err != nil {
		return err
	}
	var avatar *string
	if raw, present := body["avatar_url"]; present && truthy(raw) {
		value, err := auth.Field(body, "avatar_url", 2048)
		if err != nil {
			return err
		}
		parsed, parseErr := url.Parse(value)
		if parseErr != nil || parsed.Scheme != "https" {
			return httpx.Errorf(http.StatusBadRequest, "Avatar must use an HTTPS URL.")
		}
		avatar = &value
	}
	if err := auth.Throttle(email); err != nil {
		return err
	}
	passwordHash, err := auth.HashPassword(password)
	if err != nil {
		return err
	}
	id := "usr_" + store.RandomHex(16)
	db, err := store.Auth()
	if err != nil {
		return err
	}
	var avatarValue any
	if avatar != nil {
		avatarValue = *avatar
	}
	result, err := db.Exec(r.Context(), `INSERT OR IGNORE INTO accounts
		(id,email,name,store_name,role,avatar_url,password_hash,created_at) VALUES(?,?,?,?,'MERCHANT_ADMIN',?,?,?)`,
		id, email, name, storeName, avatarValue, passwordHash, config.NowISO())
	if err != nil {
		return err
	}
	if changes, err := result.RowsAffected(); err != nil {
		return err
	} else if changes == 0 {
		return httpx.Errorf(http.StatusConflict, "Unable to register this email. Try signing in.")
	}
	user, err := scanPublicUser(db.QueryRow(r.Context(), "SELECT "+publicAccountColumns+" FROM accounts WHERE id=?", id))
	if err != nil {
		return err
	}
	if err := auth.SetSession(w, r, id); err != nil {
		return err
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.JSON(w, http.StatusCreated, map[string]any{"success": true, "user": user})
	return nil
}

func (a *API) authLogin(w http.ResponseWriter, r *http.Request) {
	if err := a.login(w, r); err != nil {
		httpx.Error(w, err)
	}
}

func (a *API) login(w http.ResponseWriter, r *http.Request) error {
	if err := auth.AssertSameOrigin(r); err != nil {
		return err
	}
	body, err := httpx.ReadJSONBody(r, 8192)
	if err != nil {
		return err
	}
	email, password, err := auth.Credentials(body, false)
	if err != nil {
		return err
	}
	mode, err := config.ApplicationMode()
	if err != nil {
		return err
	}
	throttle := func() error { return auth.Throttle(email) }
	if mode == config.ModeDemo && demo.IsDemoEmail(email) {
		throttle = auth.ThrottleGlobal
	}
	if err := throttle(); err != nil {
		return err
	}
	db, err := store.Auth()
	if err != nil {
		return err
	}
	row := db.QueryRow(r.Context(), "SELECT "+publicAccountColumns+", password_hash FROM accounts WHERE email=?", email)
	var (
		user   types.UserAccount
		avatar sql.NullString
		hash   string
	)
	scanErr := row.Scan(&user.ID, &user.Email, &user.Name, &user.StoreName, &user.Role, &avatar, &user.CreatedAt, &hash)
	// Always verify (even for an unknown email) so timing does not reveal accounts.
	valid, verifyErr := auth.VerifyPassword(password, hash)
	if verifyErr != nil {
		return verifyErr
	}
	if errors.Is(scanErr, sql.ErrNoRows) {
		return httpx.Errorf(http.StatusUnauthorized, "Invalid email or password.")
	}
	if scanErr != nil {
		return scanErr
	}
	if !valid {
		return httpx.Errorf(http.StatusUnauthorized, "Invalid email or password.")
	}
	if err := auth.ResetThrottle(r.Context(), email); err != nil {
		return err
	}
	if avatar.Valid {
		value := avatar.String
		user.AvatarURL = &value
	}
	if err := auth.SetSession(w, r, user.ID); err != nil {
		return err
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "user": user})
	return nil
}

func (a *API) authLogout(w http.ResponseWriter, r *http.Request) {
	if err := auth.AssertSameOrigin(r); err != nil {
		httpx.Error(w, err)
		return
	}
	if err := auth.RevokeSession(r); err != nil {
		httpx.Error(w, err)
		return
	}
	auth.ClearSession(w)
	w.Header().Set("Cache-Control", "no-store")
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true})
}

func (a *API) runtimeMode(w http.ResponseWriter, r *http.Request, _ *types.UserAccount) error {
	sc, err := scope.From(r.Context())
	if err != nil {
		return err
	}
	var provider any
	if sc.Mode != config.ModeDemo {
		provider = string(sc.Mode)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"mode":                 string(sc.Mode),
		"simulation_enabled":   sc.Mode == config.ModeDemo,
		"provider_environment": provider,
	})
	return nil
}
