# Reading SKU values back from OriginFlow

**Integration specification — for the ProductToolkit team.**

OriginFlow exposes what was actually captured for a SKU, keyed by Akeneo attribute code.
This is what you need to call it, and the four behaviours that will bite you if you don't.

Implemented by [`netlify/functions/sku-attributes.ts`](../netlify/functions/sku-attributes.ts);
payload shaping and its tests live in
[`src/services/project/sku-akeneo-payload.ts`](../src/services/project/sku-akeneo-payload.ts).

---

## 1. Two directions, and they are not symmetric

There are two links between the systems. Confusing them is the fastest way to a wasted
afternoon: they differ in who calls whom, where the caller runs, and whether authentication
is required.

```
        INTERNAL NETWORK                          PUBLIC INTERNET
   ┌───────────────────────────┐            ┌───────────────────────────┐
   │  ProductToolkit           │            │  OriginFlow               │
   │  127.0.0.1:8787 + nginx   │            │  Netlify function         │
   │                           │            │            │              │
   │           ◄───── definitions (no auth) ─┤            ▼              │
   │           ├───── SKU values (bearer) ──►│  Supabase (service role)  │
   │                           │            │                           │
   │  Operator browser (VPN)   │            │                           │
   └───────────────────────────┘            └───────────────────────────┘
```

The inbound arrow is made by an operator's browser on the VPN; the outbound arrow is
server-to-server from your host.

**Inbound — already live.** OriginFlow reads `/definitions` and `/definitions/{l3}` from
ProductToolkit to import a category's attribute set. That call is made by an operator's
browser while they are on the VPN, and needs nothing from you.

**Outbound — what you are building.** Your service calls OriginFlow to read the values
captured against a SKU. Because OriginFlow is on the public internet and this data is
unreleased product information, this direction **is** authenticated. That is the asymmetry:
your API is open because only the internal network can reach it; OriginFlow cannot make the
same assumption.

---

## 2. Before you start

- **Get the bearer token.** OriginFlow holds it as a server environment variable,
  `SKU_API_TOKEN`. Ask the OriginFlow side for the value — it is a shared secret, not
  something you can self-issue. Store it as you would any other credential; never in a
  frontend bundle.

- **Confirm outbound HTTPS egress.** Your host is bound to `127.0.0.1:8787` behind nginx on
  the internal network. Calling OriginFlow means an *outbound* request to the public
  internet, which may need a firewall rule or an HTTP proxy. Check this first — it is the
  most common reason a first integration attempt fails.

- **Get the site host.** The examples use `https://<originflow-host>` as a placeholder.
  Substitute the real Netlify hostname before anything works.

> **Call it server-to-server.** The endpoint sends no CORS headers, so a request from a
> browser will be blocked. Call it from your backend and expose the result through your own
> API if the UI needs it. This is deliberate — putting a shared secret in a browser would
> publish it.

---

## 3. The contract

### Request

```http
GET https://<originflow-host>/api/skus/{skuNumber}
Authorization: Bearer <SKU_API_TOKEN>
```

`GET` only — anything else returns `405`. The SKU number may also be passed as a query
parameter, `?sku=10005399`, which is easier when the number contains characters you would
rather not URL-encode.

### Response

```json
{
  "skuNumber": "10005399",
  "matches": 1,
  "skus": [
    {
      "skuNumber":      "10005399",
      "skuTitle":       "Happy Hour 23L G Blk",
      "categoryId":     "7afe0dfb-86ce-48f3-b690-e57f866c1370",
      "categoryName":   "Beverage Coolers",
      "isFinal":        false,
      "pendingExport":  true,
      "lastExportedAt": null,
      "updatedAt":      "2026-08-28T18:17:24.212Z",
      "attributes": {
        "motor_power_W": "210",
        "has_rgb_light": "true"
      },
      "unmapped": [
        { "attributeId": "c21da4f6-...", "name": "SKU", "reason": "no-akeneo-code" }
      ]
    }
  ]
}
```

That is a real response from the live system. Note `attributes` is a flat map of Akeneo code
to **string** — every value is a string, including booleans and numbers. Cast on your side
using the field type from your own category definition.

---

## 4. Field semantics

| Field | Meaning |
| --- | --- |
| `matches` | How many SKU records carry this number. Usually 1. See gotcha 2. |
| `attributes` | Captured values keyed by Akeneo code. Only attributes that *have* a code appear. Blank values are omitted entirely. |
| `unmapped` | Values that could not be expressed as an Akeneo code, so you can tell a partial payload from an empty one. |
| `isFinal` | The SKU is locked in OriginFlow: no edits without an explicit unlock. A good signal the data is settled. |
| `pendingExport` | OriginFlow's own delta tracking — it has changes not yet exported. Read-only to you; reading never clears it. |
| `lastExportedAt` | When OriginFlow last marked this SKU exported. `null` if never. |
| `updatedAt` | Last write to the SKU. Use this for change detection rather than `pendingExport`. |

### The two `unmapped` reasons

- `no-akeneo-code` — the attribute exists in OriginFlow but carries no Akeneo code, so it
  cannot be addressed by code. Expect this for internal fields like *Product Name* and *SKU*.
- `unknown-attribute` — the value was captured against an attribute definition that has since
  been deleted. The value survives; its meaning does not. Treat it as unusable rather than
  guessing from the `name`.

---

## 5. Status codes

| Status | `code` | What it means — and what to do |
| --- | --- | --- |
| `200` | — | Found. `skus` has at least one entry. |
| `400` | `SKU_REQUIRED` | No SKU number in the path or query. A bug in your request construction. |
| `401` | `UNAUTHORIZED` | Missing or wrong bearer token. **Do not retry** — fix the credential. |
| `404` | `SKU_NOT_FOUND` | No SKU with that number. Expected and common; treat as "no data", not a failure. |
| `405` | — | You used something other than `GET`. |
| `500` | — | Server misconfiguration — usually the token or database credentials are unset on the OriginFlow side. Retrying will not help; report it. |

The endpoint is a read with no side effects, so a network-level retry is safe. Back off on
`5xx`; never retry a `401` or `404` in a loop.

---

## 6. A worked client

Node 18+, no dependencies. The shape matters more than the language — note that it
distinguishes "not found" from "failed", and never lets a `401` masquerade as an empty result.

```ts
// originflow.ts
const BASE = process.env.ORIGINFLOW_URL;      // https://<originflow-host>
const TOKEN = process.env.ORIGINFLOW_SKU_TOKEN;

export type SkuAttributes = {
  skuNumber: string;
  skuTitle: string | null;
  categoryName: string | null;
  isFinal: boolean;
  updatedAt: string | null;
  attributes: Record<string, string>;
  unmapped: { attributeId: string; name: string | null; reason: string }[];
};

/** Returns [] when the SKU is unknown. Throws only on a real failure. */
export async function fetchSkuAttributes(skuNumber: string): Promise<SkuAttributes[]> {
  const res = await fetch(`${BASE}/api/skus/${encodeURIComponent(skuNumber)}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });

  // Absence is not failure — most SKUs simply have no record.
  if (res.status === 404) return [];

  if (res.status === 401) {
    throw new Error('OriginFlow rejected the token — check ORIGINFLOW_SKU_TOKEN.');
  }
  if (!res.ok) {
    throw new Error(`OriginFlow returned ${res.status} for ${skuNumber}`);
  }

  const body = await res.json();
  return body.skus ?? [];
}
```

And the value lookup itself, which is where the two silent traps live:

```ts
/** undefined = no value captured. Never conflate with an empty string. */
export function valueFor(sku: SkuAttributes, akeneoCode: string): string | undefined {
  return sku.attributes[akeneoCode];
}

// Compare your curated definition against what was actually captured.
const [sku] = await fetchSkuAttributes('10005399');
if (sku) {
  const missing = definition.attributes
    .filter(a => a.required && valueFor(sku, a.akeneoCode) === undefined)
    .map(a => a.akeneoCode);
}
```

A one-line check that your credential and egress both work:

```bash
curl -s -H "Authorization: Bearer $ORIGINFLOW_SKU_TOKEN" \
  "https://<originflow-host>/api/skus/10005399" | jq .
```

---

## 7. Four gotchas

Each is a real property of the system, not a hypothetical. They are the difference between an
integration that works and one that quietly corrupts data.

### 1. An empty `attributes` map is normal

OriginFlow's attribute definitions were recently rebuilt from scratch, which severed every
previously captured value. Right now **every SKU returns `attributes: {}`**. Values will
reappear as SKUs are re-populated against the new definitions.

Build and test against this. An empty map means "nothing captured", never "the SKU is
broken" — and never a reason to write blanks back over good data.

### 2. SKU numbers are not unique

The same number can exist in several OriginFlow projects — currently 10 numbers do. That is
why the response is always a list and carries `matches`.

Do not blindly take `skus[0]`. Decide explicitly: use `categoryName` or `updatedAt` to pick,
or surface the collision for a human. Silently choosing the first row will one day attach one
product's specifications to another.

### 3. A missing key is not an empty value

Blank values are omitted from `attributes` rather than sent as `""`. So an absent key means
"we hold no value", and you should leave your side untouched — not overwrite it with an empty
string.

### 4. Check `unmapped` before concluding anything is missing

A payload can be partial. If a code you expect is absent, look in `unmapped` before reporting
a gap — the value may exist but be unaddressable by code. Reporting those as missing data
sends people hunting for something that is already there.

---

## 8. Not built yet

Three things you might reasonably expect do not exist. If you need any of them, ask before
designing around their absence — none is difficult to add.

- **Bulk and delta endpoints.** There is no "give me every SKU in a category" or "everything
  changed since *T*". One SKU per request. If you need to sync a whole category, that is a
  request worth making rather than looping over thousands of numbers.
- **Marking a SKU exported.** Reading never clears `pendingExport`. That flag is OriginFlow's
  own tracking, and mutating it from a `GET` you might retry would corrupt it. A separate
  explicit call would be needed.
- **Per-consumer credentials.** One shared token for everyone. It cannot be rotated for you
  alone, and there is no audit trail of who called. Worth revisiting if more than one consumer
  appears.
