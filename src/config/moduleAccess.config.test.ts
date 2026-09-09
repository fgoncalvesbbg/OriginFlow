import { describe, it, expect } from 'vitest';
import { SUPER_ADMIN_ONLY_PATH_PREFIXES, isSuperAdminOnlyPath } from './moduleAccess.config';
import { mapProfile } from '../utils/mappers.utils';
import { UserRole } from '../types';

describe('isSuperAdminOnlyPath', () => {
  it('gates the module root', () => {
    expect(isSuperAdminOnlyPath('/products')).toBe(true);
  });

  it('gates the whole subtree below a listed prefix', () => {
    expect(isSuperAdminOnlyPath('/products/123')).toBe(true);
    expect(isSuperAdminOnlyPath('/products/123/edit')).toBe(true);
  });

  it('gates the Attribute Viewer, which absorbed the SKU Catalog', () => {
    // The merge moved add/delete/bulk-overwrite/finalize/export onto '/attributes', which used
    // to be a read-and-flag screen open to everyone. Gating it is deliberate; opening it up is
    // a decision, not a side effect of the refactor.
    expect(isSuperAdminOnlyPath('/attributes')).toBe(true);
  });

  it('does not gate ungated modules', () => {
    for (const path of ['/', '/im', '/compliance', '/regulations', '/admin']) {
      expect(isSuperAdminOnlyPath(path)).toBe(false);
    }
  });

  it('matches on a path-segment boundary, not a bare string prefix', () => {
    // '/products-report' is a different module that happens to share a prefix; gating
    // it by accident would hide a shipped screen from everyone but one person.
    expect(isSuperAdminOnlyPath('/products-report')).toBe(false);
    expect(isSuperAdminOnlyPath('/project/abc')).toBe(false);
  });

  it('lists every gated prefix as an absolute path', () => {
    // A relative entry would silently never match, leaving the module wide open while
    // looking gated in this file.
    for (const prefix of SUPER_ADMIN_ONLY_PATH_PREFIXES) {
      expect(prefix.startsWith('/')).toBe(true);
      expect(prefix.endsWith('/')).toBe(false);
    }
  });
});

describe('mapProfile — super admin flag', () => {
  const row = { id: 'u1', email: 'a@b.com', name: 'A', role: 'ADMIN' };

  it('reads a true flag', () => {
    expect(mapProfile({ ...row, is_super_admin: true }).isSuperAdmin).toBe(true);
  });

  it('fails closed for false, null, undefined and a missing column', () => {
    expect(mapProfile({ ...row, is_super_admin: false }).isSuperAdmin).toBe(false);
    expect(mapProfile({ ...row, is_super_admin: null }).isSuperAdmin).toBe(false);
    expect(mapProfile(row).isSuperAdmin).toBe(false);
  });

  it('does not make an ADMIN a super admin implicitly', () => {
    const user = mapProfile(row);
    expect(user.role).toBe(UserRole.ADMIN);
    expect(user.isSuperAdmin).toBe(false);
  });

  it('keeps the tier additive to the role', () => {
    // A super admin must still read as ADMIN: ~30 RLS policies key off role='ADMIN',
    // so losing the role here would mean losing admin rights across the app.
    const user = mapProfile({ ...row, is_super_admin: true });
    expect(user.role).toBe(UserRole.ADMIN);
    expect(user.isSuperAdmin).toBe(true);
  });
});

describe('the Design Specs gate (migration 163 / Phase D)', () => {
  it('gates the module and its whole subtree', () => {
    expect(isSuperAdminOnlyPath('/design-specs')).toBe(true);
    expect(isSuperAdminOnlyPath('/design-specs/anything')).toBe(true);
  });

  it('does NOT gate the public review portal — suppliers are not signed in at all', () => {
    // The portal's authorization is the bearer token in the URL. Gating it here would be
    // both wrong and pointless: a super-admin check cannot apply to an anonymous reviewer.
    expect(isSuperAdminOnlyPath('/review/design-spec/some-token')).toBe(false);
  });

  it('does not accidentally gate a future sibling route', () => {
    expect(isSuperAdminOnlyPath('/design-specs-report')).toBe(false);
    expect(isSuperAdminOnlyPath('/design')).toBe(false);
  });
});
