/**
 * Markets — admin-configured market → language mapping (im_markets, migration 107).
 *
 * A market is a sales territory ("DACH", "FR", "BENELUX") with the set of languages
 * its manuals must include. Admins maintain the list (Admin panel → Markets); the
 * print-export dialog offers markets as one-click language presets and stamps the
 * chosen market code onto the im_print_renders history row — making "which booklet
 * was produced for which market" answerable from the render log.
 */

import { db, orEmpty, type Row } from '../../data';
import { isLive } from '../../config/environment.config';

export interface IMMarket {
  id: string;
  /** Short stable key shown in pickers and stamped on render rows, e.g. "DACH". */
  code: string;
  name: string;
  /** ISO 639-1 codes this market's manuals must include, in booklet order. */
  languages: string[];
  sort: number;
}

const mapRow = (r: any): IMMarket => ({
  id: r.id,
  code: r.code,
  name: r.name,
  languages: r.languages ?? [],
  sort: r.sort ?? 0,
});

/** All markets, in display order. */
export const getIMMarkets = async (): Promise<IMMarket[]> => {
  if (!isLive) return [];
  const rows = await orEmpty(
    db.select<Row>('im_markets', { order: { column: 'sort', ascending: true } }),
    '[getIMMarkets]',
  );
  return rows.map(mapRow).sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code));
};

/** Create or update a market. Insert when `id` is absent. */
export const saveIMMarket = async (market: Partial<IMMarket> & { code: string; name: string; languages: string[] }): Promise<IMMarket> => {
  const payload = {
    code: market.code.trim().toUpperCase(),
    name: market.name.trim(),
    languages: market.languages,
    sort: market.sort ?? 0,
    updated_at: new Date().toISOString(),
  };
  if (market.id) {
    await db.updateWhere('im_markets', payload, { where: { id: market.id } });
    return { id: market.id, ...payload, sort: payload.sort };
  }
  const created = await db.insert<Row>('im_markets', payload);
  return mapRow(created);
};

export const deleteIMMarket = async (id: string): Promise<void> => {
  await db.delete('im_markets', { where: { id } });
};
