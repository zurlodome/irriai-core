# Irrifarm application hand-off

This integration lets an authenticated Irrifarm user open nao without seeing nao's login page. It does not change or replace Irrifarm's existing username/password login.

For the current dev deployment checklist and smoke procedure, see [auth-irrifarm-dev.md](./auth-irrifarm-dev.md).

## Browser hand-off

The Irrifarm backend obtains an Irrifarm app JWT and returns an auto-submitting form to the browser. Passwords must never be sent to nao.

```html
<form method="post" action="https://nao.example.com/api/auth/sign-in/irrifarm">
	<input type="hidden" name="token" value="IRRIFARM_JWT" />
	<input type="hidden" name="username" value="IRRIFARM_USERNAME" />
	<!-- Required once IRRIFARM_AUTH_MODE=check-user -->
	<input type="hidden" name="regId" value="DEVICE_UUID" />
</form>
<script>
	document.forms[0].submit();
</script>
```

The endpoint validates the Irrifarm identity, fetches its authorized motherboards, creates or finds the linked nao user, sets the normal Better Auth session cookie, and redirects to `/`.

Open `/api/auth/irrifarm/test` to use the temporary test hand-off with separate Domenico and Vincenzo buttons. The browser prompts for HTTP Basic credentials: username `test` and the password configured in `IRRIFARM_TEST_PAGE_PASSWORD`. Both the page and its POST action require these credentials. The nao backend obtains the JWT from Irrifarm using separate server-side test credentials; neither those passwords nor the JWT are rendered in the browser. The page is disabled unless explicitly enabled and returns 503 if the page password is missing.

To expose it temporarily in a test deployment running with `MODE=prod`, configure:

```env
MODE=prod
BETTER_AUTH_URL=https://nao.example.com
IRRIFARM_TEST_PAGE_ENABLED=true
IRRIFARM_TEST_PAGE_PASSWORD=<strong secret App Service or Key Vault reference>
IRRIFARM_TEST_USERNAME=domenico
IRRIFARM_TEST_PASSWORD=<secret App Service or Key Vault reference>
IRRIFARM_TEST_ADMIN_PASSWORD=<secret App Service or Key Vault reference>
```

The page will be available at `https://nao.example.com/api/auth/irrifarm/test`. Use HTTPS and restrict it to the agreed client IPs at the App Service layer. Set `IRRIFARM_TEST_PAGE_ENABLED=false` and remove the test credentials after testing. Never commit the test passwords or expose them to browser code.

The JWT, username, or IDs must not be placed in the URL. Configure the Irrifarm application origin in `IRRIFARM_APP_ORIGINS` so Better Auth can enforce its origin check.

## Validation modes

`IRRIFARM_AUTH_MODE=fixture` is the temporary test path. It accepts the configured Domenico fixture and, when supplied, the Vincenzo admin fixture. The JWT is still validated remotely by calling `GetMotherBoardsByClient` for the selected user; only `CheckUser` is skipped.

```env
IRRIFARM_BASE_URL=https://app-irrifarm-service.example
IRRIFARM_AUTH_MODE=fixture
IRRIFARM_FIXTURE_USERNAME=domenico
IRRIFARM_FIXTURE_USER_ID=470
IRRIFARM_FIXTURE_CLIENT_ID=204
IRRIFARM_FIXTURE_CLIENT_LEVEL=20
IRRIFARM_FIXTURE_ADMIN_USERNAME=vincenzo
IRRIFARM_FIXTURE_ADMIN_USER_ID=605
IRRIFARM_FIXTURE_ADMIN_CLIENT_ID=1
IRRIFARM_FIXTURE_ADMIN_CLIENT_LEVEL=1
```

`IRRIFARM_AUTH_MODE=check-user` is the final path. `regId` is mandatory and nao requires `CheckUser.active=true`. The returned values are mapped as follows:

| CheckUser         | GetMotherBoardsByClient |
| ----------------- | ----------------------- |
| `userClientId`    | `Client_Id`             |
| `userId`          | `USR_Id`                |
| `userClientLevel` | `IdClientLevel`         |

## nao user identity

The first successful hand-off creates a local Better Auth user and links it to `providerId=irrifarm` using the Irrifarm `userId` as the stable account identifier. Later hand-offs reuse the same user, refresh its Irrifarm attributes and authorized MBO list, and create a new session.

Better Auth requires an email value even when Irrifarm does not provide one. nao therefore stores a non-deliverable technical address internally. The frontend displays `Irrifarm account · ID <userId>` instead and must not use the technical address for newsletters, automations, or analytics.

Do not accept an email from an unsigned browser form as a verified identity attribute. A real email may replace the technical value only when it comes from a signed Irrifarm JWT claim or from the authenticated `CheckUser` response.

## Multiple motherboards

The authorized MBO list is refreshed at each successful Irrifarm sign-in:

- with exactly one MBO, phrases such as “my control unit” resolve automatically to that serial;
- with multiple MBOs, “my control units” and “of my competence” refer to the complete authorized set;
- when a request genuinely requires exactly one MBO but the user uses a singular ambiguous expression, the agent first retrieves the scoped motherboard aliases and serials and asks the user to choose;
- the user is never asked to provide an opaque serial without being shown the authorized choices.

These conversational rules improve usability only. Authorization is always enforced independently by the server-side SQL scope.

## SQL scope policy

Authorized MBO serials are stored server-side and sent to the Python query sidecar. The sidecar rewrites every configured physical table into an MBO-scoped subquery. It rejects unclassified tables for Irrifarm users.

The FastAPI sidecar must remain reachable only by the trusted nao backend: external callers must not be able to omit or replace `allowed_mbo_sns`.

```env
IRRIFARM_MBO_SCOPE_COLUMNS={"motherboards":"MBO_SN","senshistory":"MBO_SN","proghistory":"MboSn"}
IRRIFARM_MBO_UNSCOPED_TABLES=products
```

The mapping must include every queryable Irrifarm data table. Add only genuinely global, non-customer-specific tables to the unscoped allowlist.

## Large-scope query guardrails

Guardrails constrain query cost and response size without removing any authorized MBO from the user scope:

```env
IRRIFARM_LARGE_SCOPE_THRESHOLD=50
IRRIFARM_MAX_QUERY_ROWS=500
IRRIFARM_QUERY_TIMEOUT_MS=15000
```

When the user has more MBOs than `IRRIFARM_LARGE_SCOPE_THRESHOLD`, the agent must start inventory requests with `COUNT(*)` or grouped summaries instead of loading the complete motherboard list. Discovery queries show at most 50 aliases/serials at a time. Telemetry and history queries must use a bounded time interval and aggregate in SQL; if the interval is missing, the agent asks for it before querying.

For every Irrifarm SQL request, the sidecar adds or clamps the outer query limit to `IRRIFARM_MAX_QUERY_ROWS`. The response reports the applied limit so the agent cannot mistake a truncated result for an exact total. Queries on `senshistory` must use a statically bounded `SNS_DtEvent` range: at most 7 days for raw rows and 366 days for aggregates. On MySQL, the sidecar also injects the server-side `MAX_EXECUTION_TIME` optimizer hint; the backend independently aborts its HTTP wait after `IRRIFARM_QUERY_TIMEOUT_MS` and asks the agent to narrow the MBO or time selection.

These controls are independent from database indexes. For large telemetry tables, verify that an appropriate index such as `(MBO_SN, SNS_SysDateIns)` already exists before considering a new one.

## API smoke test

The smoke command generates a JWT, optionally runs `CheckUser`, and calls `GetMotherBoardsByClient`. It never prints the JWT or password.

```powershell
$env:IRRIFARM_TEST_USERNAME='domenico'
$env:IRRIFARM_TEST_PASSWORD='...'
$env:IRRIFARM_TEST_USER_ID='470'
$env:IRRIFARM_TEST_CLIENT_ID='204'
$env:IRRIFARM_TEST_CLIENT_LEVEL='20'
npm.cmd run -w @nao/backend irrifarm:smoke
```

Set `IRRIFARM_TEST_REG_ID` to include `CheckUser` in the smoke test. Test credentials must stay outside committed files.
