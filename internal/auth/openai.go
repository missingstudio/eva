package auth

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// The OpenAI device-code flow. The client ID and endpoints are the public
// Codex CLI's, because the subscription backend only accepts tokens minted
// that way — there is no client ID a third party can register for this.
const openAIClientID = "app_EMoamEEZ73f0CkXaXp7hrann"

// authBase is the authorization server every OpenAI endpoint below hangs off.
// It is a variable so a test can stand up a server of its own and point one
// login at it; nothing in production writes it.
var authBase = "https://auth.openai.com"

func openAIUserCodeURL() string    { return authBase + "/api/accounts/deviceauth/usercode" }
func openAIDeviceTokenURL() string { return authBase + "/api/accounts/deviceauth/token" }
func openAITokenURL() string       { return authBase + "/oauth/token" }

// OpenAIVerifyURL is where a person enters the code a login shows them. It is
// exported for the layer that does the showing.
func OpenAIVerifyURL() string { return authBase + "/codex/device" }

// defaultPollTimeout bounds the wait for the browser approval. The codes the
// server mints expire on the same horizon, so waiting longer waits for a code
// that can no longer be approved.
const defaultPollTimeout = 15 * time.Minute

// LoginOptions configures one interactive login.
type LoginOptions struct {
	// OnDeviceCode is shown the verification URL and the code a person must
	// enter there, once, before the wait begins.
	OnDeviceCode func(verifyURL, userCode string)
	// Timeout bounds the wait for approval. Zero takes the default, which is
	// the lifetime of the code itself.
	Timeout time.Duration
}

// LoginOpenAI runs the device-code flow and returns the Credentials it ends
// in. It blocks until the browser approval completes, ctx is cancelled, or the
// timeout elapses — a login is a conversation with a person, and the waiting
// is the point.
//
// The flow is a device grant with the PKCE half inverted: the server generates
// the code verifier and hands it back beside the authorization code, so this
// client never computes a challenge. Three requests: mint a user code, poll
// until the person approves, exchange what the poll returned for tokens.
func LoginOpenAI(ctx context.Context, opts LoginOptions) (Credentials, error) {
	httpc := &http.Client{Timeout: 30 * time.Second}

	code, err := requestDeviceCode(ctx, httpc)
	if err != nil {
		return Credentials{}, err
	}
	if opts.OnDeviceCode != nil {
		opts.OnDeviceCode(OpenAIVerifyURL(), code.userCode)
	}

	approved, err := pollDeviceCode(ctx, httpc, code, opts.Timeout)
	if err != nil {
		return Credentials{}, err
	}

	form := url.Values{
		"grant_type":    {"authorization_code"},
		"client_id":     {openAIClientID},
		"code":          {approved.authorizationCode},
		"code_verifier": {approved.codeVerifier},
		// The exchange requires the flow's fixed callback even though nothing
		// was redirected anywhere: it is part of the grant being validated.
		"redirect_uri": {authBase + "/deviceauth/callback"},
	}
	return postToken(ctx, httpc, form)
}

// RefreshOpenAI renews a credential set from its refresh token.
//
// httpc is the client to renew with, and nil takes a bounded default — a
// renewal with no deadline would park the turn that triggered it.
func RefreshOpenAI(ctx context.Context, httpc *http.Client, refreshToken string) (Credentials, error) {
	if httpc == nil {
		httpc = &http.Client{Timeout: 30 * time.Second}
	}
	form := url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {refreshToken},
		"client_id":     {openAIClientID},
	}
	creds, err := postToken(ctx, httpc, form)
	if err != nil {
		return Credentials{}, err
	}
	// A renewal may omit a new refresh token. The old one is still live in
	// that case, and dropping it would turn every renewal into a logout.
	if creds.RefreshToken == "" {
		creds.RefreshToken = refreshToken
	}
	return creds, nil
}

type deviceCode struct {
	userCode     string
	deviceAuthID string
	interval     time.Duration
}

type deviceApproval struct {
	authorizationCode string
	codeVerifier      string
}

func requestDeviceCode(ctx context.Context, httpc *http.Client) (deviceCode, error) {
	var out struct {
		DeviceAuthID string `json:"device_auth_id"`
		// The server has answered with either spelling; a login must not fail
		// on which one today's deployment chose.
		UserCode string       `json:"user_code"`
		Usercode string       `json:"usercode"`
		Interval pollInterval `json:"interval"`
	}
	status, body, err := postJSON(ctx, httpc, openAIUserCodeURL(), map[string]string{
		"client_id": openAIClientID,
	})
	if err != nil {
		return deviceCode{}, err
	}
	if status >= 400 {
		return deviceCode{}, fmt.Errorf("auth: the device-code endpoint answered %d: %s", status, string(body))
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return deviceCode{}, fmt.Errorf("auth: decode the device-code response: %w", err)
	}

	userCode := out.UserCode
	if userCode == "" {
		userCode = out.Usercode
	}
	if out.DeviceAuthID == "" || userCode == "" {
		return deviceCode{}, fmt.Errorf("auth: the device-code response named no device_auth_id or user_code")
	}

	interval := time.Duration(out.Interval) * time.Second
	if interval <= 0 {
		interval = 5 * time.Second
	}
	return deviceCode{userCode: userCode, deviceAuthID: out.DeviceAuthID, interval: interval}, nil
}

func pollDeviceCode(ctx context.Context, httpc *http.Client, code deviceCode, timeout time.Duration) (deviceApproval, error) {
	if timeout <= 0 {
		timeout = defaultPollTimeout
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	for {
		approved, pending, err := pollOnce(ctx, httpc, code)
		if err != nil {
			return deviceApproval{}, err
		}
		if !pending {
			return approved, nil
		}

		timer := time.NewTimer(code.interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return deviceApproval{}, fmt.Errorf("auth: the login was not approved within %s", timeout)
		case <-timer.C:
		}
	}
}

func pollOnce(ctx context.Context, httpc *http.Client, code deviceCode) (deviceApproval, bool, error) {
	status, body, err := postJSON(ctx, httpc, openAIDeviceTokenURL(), map[string]string{
		"device_auth_id": code.deviceAuthID,
		"user_code":      code.userCode,
	})
	if err != nil {
		return deviceApproval{}, false, err
	}

	// The endpoint answers 403 and 404 while the approval has not happened, so
	// both mean "still pending". The cost is that a genuinely dead
	// device_auth_id polls until the timeout — the server gives no way to tell
	// the two apart, and the codes expire on the same horizon anyway.
	if status == http.StatusForbidden || status == http.StatusNotFound {
		return deviceApproval{}, true, nil
	}
	if status >= 400 {
		return deviceApproval{}, false, fmt.Errorf("auth: the device-code poll answered %d: %s", status, string(body))
	}

	var out struct {
		AuthorizationCode string `json:"authorization_code"`
		CodeVerifier      string `json:"code_verifier"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return deviceApproval{}, false, fmt.Errorf("auth: decode the device-code poll: %w", err)
	}
	if out.AuthorizationCode == "" || out.CodeVerifier == "" {
		return deviceApproval{}, false, fmt.Errorf("auth: the approval named no authorization_code or code_verifier")
	}
	return deviceApproval{authorizationCode: out.AuthorizationCode, codeVerifier: out.CodeVerifier}, false, nil
}

func postJSON(ctx context.Context, httpc *http.Client, endpoint string, in any) (int, []byte, error) {
	body, err := json.Marshal(in)
	if err != nil {
		return 0, nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpc.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, raw, nil
}

func postToken(ctx context.Context, httpc *http.Client, form url.Values) (Credentials, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, openAITokenURL(), strings.NewReader(form.Encode()))
	if err != nil {
		return Credentials{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := httpc.Do(req)
	if err != nil {
		return Credentials{}, err
	}
	defer func() { _ = resp.Body.Close() }()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return Credentials{}, fmt.Errorf("auth: the token endpoint answered %d: %s", resp.StatusCode, string(body))
	}

	var tr struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &tr); err != nil {
		return Credentials{}, fmt.Errorf("auth: decode the token response: %w", err)
	}
	if tr.AccessToken == "" {
		return Credentials{}, fmt.Errorf("auth: the token response carried no access_token")
	}

	// Refused here, at login, rather than discovered on the first turn: a
	// token without the account claim is one the subscription backend will
	// reject, so storing it would store a login that cannot spend.
	accountID, err := accountIDFromToken(tr.AccessToken)
	if err != nil {
		return Credentials{}, err
	}
	return Credentials{
		AccessToken:  tr.AccessToken,
		RefreshToken: tr.RefreshToken,
		ExpiresAt:    time.Now().Add(time.Duration(tr.ExpiresIn) * time.Second),
		AccountID:    accountID,
	}, nil
}

// accountIDFromToken reads the ChatGPT account id out of the access token.
//
// The token is a JWT and the id lives in a namespaced claim. The subscription
// backend requires the id as a header on every request, so a token that does
// not carry it is not a credential for that backend, whatever else it is.
func accountIDFromToken(token string) (string, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "", fmt.Errorf("auth: the access token is not a JWT")
	}
	payload, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(parts[1], "="))
	if err != nil {
		return "", fmt.Errorf("auth: decode the token payload: %w", err)
	}
	var claims struct {
		Auth struct {
			ChatGPTAccountID string `json:"chatgpt_account_id"`
		} `json:"https://api.openai.com/auth"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return "", fmt.Errorf("auth: parse the token claims: %w", err)
	}
	if claims.Auth.ChatGPTAccountID == "" {
		return "", fmt.Errorf("auth: the token carries no chatgpt_account_id claim")
	}
	return claims.Auth.ChatGPTAccountID, nil
}

// pollInterval tolerates the two shapes the server has sent the interval in:
// a number, and a string holding one.
type pollInterval int

func (p *pollInterval) UnmarshalJSON(b []byte) error {
	var n int
	if err := json.Unmarshal(b, &n); err == nil {
		*p = pollInterval(n)
		return nil
	}

	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return err
	}
	s = strings.TrimSpace(s)
	if s == "" {
		*p = 0
		return nil
	}
	parsed, err := strconv.Atoi(s)
	if err != nil {
		return err
	}
	*p = pollInterval(parsed)
	return nil
}
