/**
 * Covers the ProductToolkit transport layer: how it reports the failures that actually
 * happen in the field, rather than only the happy path.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import http from 'node:http';
import { getProductToolkitDefinition, ProductToolkitUnavailableError } from './producttoolkit-attributes.service';

const serve = async (handler: (req: any, res: any) => void) => {
  const server = http.createServer(handler);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as any).port;
  vi.stubEnv('VITE_PRODUCTTOOLKIT_URL', `http://127.0.0.1:${port}/apps/attribute-viewer`);
  return server;
};

afterEach(() => vi.unstubAllEnvs());

describe('ProductToolkit transport', () => {
  it('tells the operator to sign in when ProductToolkit answers 401', async () => {
    // The live API started requiring a session; a bare "responded 401" left people guessing.
    const server = await serve((_req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Please sign in', code: 'AUTH_REQUIRED', loginUrl: '/auth/login' }));
    });
    try {
      await expect(getProductToolkitDefinition('Angled Hoods')).rejects.toThrow(/signed-in session \(401\)/);
      await expect(getProductToolkitDefinition('Angled Hoods')).rejects.toThrow(/auth\/login/);
    } finally { server.close(); }
  });

  it('treats 403 the same way as 401', async () => {
    const server = await serve((_req, res) => { res.writeHead(403); res.end('{}'); });
    try {
      await expect(getProductToolkitDefinition('X')).rejects.toThrow(/signed-in session \(403\)/);
    } finally { server.close(); }
  });

  it('still reports a missing definition as "no definition", not an error', async () => {
    const server = await serve((_req, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'none', code: 'NO_DEFINITION' }));
    });
    try {
      await expect(getProductToolkitDefinition('Glass-Ceramic Hobs')).resolves.toBeNull();
    } finally { server.close(); }
  });

  it('leads with certificate trust, and names a check that settles it', async () => {
    // A TLS failure, an outage and a blocked origin are indistinguishable to the caller — the
    // browser hides which. The internal CA is the likeliest of the three here, and the only
    // one an operator can confirm themselves, so the message leads with it and says how.
    vi.stubEnv('VITE_PRODUCTTOOLKIT_URL', 'http://127.0.0.1:1/apps/attribute-viewer');
    const err = await getProductToolkitDefinition('X').catch(e => e);
    expect(err).toBeInstanceOf(ProductToolkitUnavailableError);
    expect(err.message).toMatch(/internal CA/);
    expect(err.message).toMatch(/\/api\/health/);       // the concrete check
    expect(err.message).toMatch(/only for that browser session/); // why it "worked once"
    expect(err.message).toMatch(/VPN/);
  });

  it('sends no credentials — a wildcard ACAO rejects credentialed requests', async () => {
    // ProductToolkit returns Access-Control-Allow-Origin: *, which browsers refuse to honour
    // when credentials are included. Including them would break a working call.
    let sawCookieHeader: string | undefined;
    const server = await serve((req, res) => {
      sawCookieHeader = req.headers.cookie;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ l3: 'X', attributes: [] }));
    });
    try {
      await getProductToolkitDefinition('X');
      expect(sawCookieHeader).toBeUndefined();
    } finally { server.close(); }
  });
});
