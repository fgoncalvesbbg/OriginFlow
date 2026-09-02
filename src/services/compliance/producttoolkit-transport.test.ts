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

  it('names the CORS case first when the fetch fails at network level', async () => {
    // A blocked cross-origin response is indistinguishable from an outage in the browser, so
    // the message has to name all three causes — CORS first, since it is now the likeliest.
    vi.stubEnv('VITE_PRODUCTTOOLKIT_URL', 'http://127.0.0.1:1/apps/attribute-viewer');
    const err = await getProductToolkitDefinition('X').catch(e => e);
    expect(err).toBeInstanceOf(ProductToolkitUnavailableError);
    expect(err.message).toMatch(/Access-Control-Allow-Origin/);
    expect(err.message).toMatch(/VPN/);
    expect(err.message).toMatch(/certificate/);
  });
});
