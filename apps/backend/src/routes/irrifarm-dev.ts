import type { App } from '../app';
import { env } from '../env';
import { IrrifarmApiClient } from '../services/irrifarm-api.client';

export function shouldRegisterIrrifarmTestPage(_mode: string, explicitlyEnabled: boolean): boolean {
	return explicitlyEnabled;
}

export const irrifarmTestPageRoutes = async (app: App) => {
	app.get('/test', async (_request, reply) => {
		reply
			.header('Cache-Control', 'no-store')
			.header('Pragma', 'no-cache')
			.header('X-Content-Type-Options', 'nosniff')
			.header(
				'Content-Security-Policy',
				"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
			)
			.type('text/html; charset=utf-8')
			.send(renderIrrifarmSsoTestPage(env.IRRIFARM_AUTH_MODE));
	});

	app.post('/test', async (request, reply) => {
		const account = (request.body as { account?: string } | undefined)?.account ?? 'domenico';
		if (account !== 'domenico' && account !== 'vincenzo') {
			return reply.status(400).type('text/plain; charset=utf-8').send('Account demo non valido.');
		}
		const username =
			account === 'vincenzo'
				? env.IRRIFARM_FIXTURE_ADMIN_USERNAME
				: (env.IRRIFARM_TEST_USERNAME ?? env.IRRIFARM_FIXTURE_USERNAME);
		const password = account === 'vincenzo' ? env.IRRIFARM_TEST_ADMIN_PASSWORD : env.IRRIFARM_TEST_PASSWORD;
		if (!env.IRRIFARM_BASE_URL || !username || !password) {
			return reply.status(503).type('text/plain; charset=utf-8').send('Accesso demo non configurato.');
		}

		try {
			const client = new IrrifarmApiClient({
				baseUrl: env.IRRIFARM_BASE_URL,
				timeoutMs: env.IRRIFARM_REQUEST_TIMEOUT_MS,
			});
			const token = await client.createAppToken(username, password);
			const { dispatchAuthRequest } = await import('./auth');
			const response = await dispatchAuthRequest({
				method: 'POST',
				url: '/api/auth/sign-in/irrifarm',
				headers: {
					...request.headers,
					'content-type': 'application/json',
				},
				body: { token, username },
			});

			reply.status(response.status);
			response.headers.forEach((value, key) => reply.header(key, value));
			return reply.send(response.body ? await response.text() : null);
		} catch (error) {
			request.log.error({ err: error }, 'Irrifarm demo sign-in failed');
			return reply.status(502).type('text/plain; charset=utf-8').send('Accesso demo non riuscito. Riprova.');
		}
	});
};

export function renderIrrifarmSsoTestPage(mode: string): string {
	const authMode = escapeHtml(mode);

	return `<!doctype html>
<html lang="it">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<meta name="referrer" content="strict-origin" />
		<title>Test IrriAI</title>
		<style>
			:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
			body { margin: 0; padding: 2rem; background: #f4f7f5; color: #17221c; }
			main { max-width: 42rem; margin: 0 auto; padding: 2rem; border: 1px solid #cbd8d0; border-radius: 12px; background: white; box-shadow: 0 8px 28px #17221c18; }
			h1 { margin-top: 0; font-size: 1.5rem; }
			p { line-height: 1.5; }
			.mode { display: inline-block; padding: .2rem .55rem; border-radius: 999px; background: #e3f3e8; font-family: ui-monospace, monospace; }
			button { margin-top: 1.25rem; padding: .75rem 1rem; border: 0; border-radius: 6px; background: #168548; color: white; font: inherit; font-weight: 700; cursor: pointer; }
			.note { margin-bottom: 0; color: #536158; font-size: .9rem; }
		</style>
	</head>
	<body>
		<main>
			<h1>Ambiente di collaudo IrriAI</h1>
			<p>Modalità backend: <span class="mode">${authMode}</span></p>
			<p>Accesso riservato al collaudo concordato. Le credenziali tecniche sono gestite dal server e non vengono inviate al browser.</p>
			<form method="post" action="/api/auth/irrifarm/test">
				<button type="submit" name="account" value="domenico">Accedi come Domenico (singolo MBO)</button>
				<button type="submit" name="account" value="vincenzo">Accedi come Vincenzo (tutti i controller)</button>
			</form>
			<p class="note">Ogni pulsante genera una sessione temporanea per l'account Irrifarm selezionato.</p>
		</main>
	</body>
</html>`;
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>'"]/g, (character) => {
		const entities: Record<string, string> = {
			'&': '&amp;',
			'<': '&lt;',
			'>': '&gt;',
			"'": '&#39;',
			'"': '&quot;',
		};
		return entities[character];
	});
}
