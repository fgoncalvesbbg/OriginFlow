/**
 * Unit tests for the pure half of the doc_* access layer.
 *
 * The visibility rule and the DTO whitelists are the two things in this module that must
 * not be wrong, and both are pure functions precisely so they can be tested exhaustively
 * here rather than inferred from a handler test. The handler tests in
 * netlify/functions/doc-security.test.ts then prove the routes actually use them.
 */

import { describe, it, expect } from 'vitest';
import {
  friendlyFilename,
  isOwnedStorageKey,
  isPdf,
  supplierMaySeeVersion,
  toInternalVersionDto,
  toSupplierVersionDto,
  toSupplierDocumentDto,
  toInternalDocumentDto,
  versionStorageKey,
  assertOptionalLink,
  assertEnum,
  assertTags,
  DOC_TYPES,
  type DocumentRow,
  type VersionRow,
} from './doc-access';

const DOCUMENT: DocumentRow = {
  id: '55555555-5555-4555-8555-555555555555',
  title: 'Packaging Guideline',
  doc_type: 'guideline',
  audience: 'supplier',
  owner_user_id: '99999999-9999-4999-8999-999999999999',
  tags: ['packaging', 'eu'],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
};

const VERSION: VersionRow = {
  id: '77777777-7777-4777-8777-777777777777',
  document_id: DOCUMENT.id,
  label: 'v4',
  is_final: true,
  finalized_by: '99999999-9999-4999-8999-999999999999',
  finalized_at: '2026-01-02T00:00:00Z',
  sharepoint_link: 'https://contoso.sharepoint.com/sites/plm/Packaging%20Guideline.docx',
  pdf_storage_path: 'docs/55555555-5555-4555-8555-555555555555/77777777-7777-4777-8777-777777777777/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf',
  pdf_sha256: 'a'.repeat(64),
  pdf_bytes: 123456,
  superseded_by: null,
  uploaded_by: '99999999-9999-4999-8999-999999999999',
  created_at: '2026-01-01T00:00:00Z',
};

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';

describe('supplierMaySeeVersion — the three clauses', () => {
  const base = {
    document: DOCUMENT,
    version: VERSION,
    boundProjectIds: [P1],
    supplierProjectIds: [P1],
  };

  it('allows a final, supplier-facing, bound version', () => {
    expect(supplierMaySeeVersion(base)).toBe(true);
  });

  it('refuses a non-final version, even when everything else lines up', () => {
    expect(supplierMaySeeVersion({ ...base, version: { is_final: false } })).toBe(false);
  });

  it('refuses an internal-audience document, even when it is final and bound', () => {
    expect(supplierMaySeeVersion({ ...base, document: { audience: 'internal' } })).toBe(false);
  });

  it('refuses a document bound to no project at all', () => {
    expect(supplierMaySeeVersion({ ...base, boundProjectIds: [] })).toBe(false);
  });

  it('refuses a document bound only to a project this supplier is not on', () => {
    expect(supplierMaySeeVersion({ ...base, boundProjectIds: [P2] })).toBe(false);
  });

  it('refuses a supplier with no projects', () => {
    expect(supplierMaySeeVersion({ ...base, supplierProjectIds: [] })).toBe(false);
  });

  it('allows when any one of several bindings overlaps', () => {
    expect(supplierMaySeeVersion({
      ...base,
      boundProjectIds: [P2, P1],
      supplierProjectIds: [P1],
    })).toBe(true);
  });
});

describe('DTO whitelists', () => {
  it('never puts sharepoint_link in a supplier version DTO', () => {
    const dto = toSupplierVersionDto(VERSION);
    expect(JSON.stringify(dto)).not.toContain('sharepoint');
    expect(JSON.stringify(dto)).not.toContain('contoso');
    expect('sharepointLink' in dto).toBe(false);
  });

  it('never puts the storage path in ANY version DTO, internal included', () => {
    for (const dto of [toSupplierVersionDto(VERSION), toInternalVersionDto(VERSION)]) {
      const json = JSON.stringify(dto);
      expect(json).not.toContain('docs/');
      expect(json).not.toContain('pdf_storage_path');
      expect(json).not.toContain('storagePath');
    }
  });

  it('does give an internal caller the sharepoint link — that is the point of the split', () => {
    expect(toInternalVersionDto(VERSION).sharepointLink).toBe(VERSION.sharepoint_link);
  });

  it('reports hasPdf without revealing where the pdf is', () => {
    expect(toInternalVersionDto(VERSION).hasPdf).toBe(true);
    expect(toInternalVersionDto({ ...VERSION, pdf_storage_path: null }).hasPdf).toBe(false);
  });

  it('does not leak the audience or owner to a supplier', () => {
    const dto = toSupplierDocumentDto(DOCUMENT);
    expect(Object.keys(dto).sort()).toEqual(['docType', 'id', 'tags', 'title']);
  });

  it('gives an internal caller the full document record', () => {
    const dto = toInternalDocumentDto(DOCUMENT);
    expect(dto.audience).toBe('supplier');
    expect(dto.ownerUserId).toBe(DOCUMENT.owner_user_id);
  });

  it('survives a new column being added to the row without leaking it', () => {
    // A denylist would let this through; a whitelist cannot.
    const withNewColumn = { ...VERSION, secret_internal_note: 'do not share' } as VersionRow;
    expect(JSON.stringify(toSupplierVersionDto(withNewColumn))).not.toContain('do not share');
    expect(JSON.stringify(toInternalVersionDto(withNewColumn))).not.toContain('do not share');
  });

  it('tolerates a null tags array', () => {
    expect(toSupplierDocumentDto({ ...DOCUMENT, tags: null }).tags).toEqual([]);
  });
});

describe('isPdf — magic bytes, not the extension', () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7

  it('accepts a real PDF header', () => {
    expect(isPdf(pdf)).toBe(true);
  });

  it('rejects HTML that happens to be named .pdf', () => {
    expect(isPdf(new TextEncoder().encode('<!doctype html><html>'))).toBe(false);
  });

  it('rejects a ZIP (the shape of every Office file)', () => {
    expect(isPdf(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]))).toBe(false);
  });

  it('rejects an empty file and a truncated header', () => {
    expect(isPdf(new Uint8Array([]))).toBe(false);
    expect(isPdf(new Uint8Array([0x25, 0x50, 0x44]))).toBe(false);
  });

  it('rejects a PDF header that is not at offset 0', () => {
    expect(isPdf(new Uint8Array([0x0a, 0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe(false);
  });
});

describe('storage keys', () => {
  const documentId = DOCUMENT.id;
  const versionId = VERSION.id;
  const random = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  it('is built from ids and a random uuid, never from the title or label', () => {
    const key = versionStorageKey(documentId, versionId, random);
    expect(key).toBe(`docs/${documentId}/${versionId}/${random}.pdf`);
    expect(key).not.toContain('Packaging');
    expect(key).not.toContain('v4');
  });

  it('accepts a key it minted itself', () => {
    expect(isOwnedStorageKey(versionStorageKey(documentId, versionId, random), documentId, versionId)).toBe(true);
  });

  it('rejects a key belonging to another document', () => {
    const other = '00000000-0000-4000-8000-000000000000';
    expect(isOwnedStorageKey(versionStorageKey(other, versionId, random), documentId, versionId)).toBe(false);
  });

  it('rejects traversal and hand-written keys', () => {
    expect(isOwnedStorageKey(`docs/${documentId}/${versionId}/../../evil.pdf`, documentId, versionId)).toBe(false);
    expect(isOwnedStorageKey(`docs/${documentId}/${versionId}/anything.pdf`, documentId, versionId)).toBe(false);
    expect(isOwnedStorageKey('', documentId, versionId)).toBe(false);
  });
});

describe('friendlyFilename', () => {
  it('is readable and carries the label', () => {
    expect(friendlyFilename('Packaging Guideline', 'v4')).toBe('Packaging-Guideline_v4.pdf');
  });

  it('strips characters that would break or inject a Content-Disposition header', () => {
    const name = friendlyFilename('Spec "quoted"\r\nX-Injected: yes', '2026-03');
    expect(name).not.toMatch(/["\r\n]/);
    expect(name.endsWith('.pdf')).toBe(true);
  });

  it('still produces a usable name when the title has nothing ASCII in it', () => {
    expect(friendlyFilename('包装规范', 'v1')).toBe('document_v1.pdf');
  });
});

describe('input validators', () => {
  it('refuses a javascript: sharepoint link', () => {
    expect(() => assertOptionalLink('javascript:alert(1)', 'sharepointLink')).toThrow();
    expect(() => assertOptionalLink('data:text/html,<script>', 'sharepointLink')).toThrow();
  });

  it('accepts https and treats empty as absent', () => {
    expect(assertOptionalLink('https://contoso.sharepoint.com/x.docx', 'l')).toBe('https://contoso.sharepoint.com/x.docx');
    expect(assertOptionalLink('', 'l')).toBeNull();
    expect(assertOptionalLink(null, 'l')).toBeNull();
  });

  it('constrains doc_type to the documented set', () => {
    expect(assertEnum('sop', DOC_TYPES, 'docType')).toBe('sop');
    expect(() => assertEnum('invoice', DOC_TYPES, 'docType')).toThrow();
  });

  it('rejects malformed tag arrays', () => {
    expect(assertTags(['a', 'b'])).toEqual(['a', 'b']);
    expect(assertTags(null)).toEqual([]);
    expect(() => assertTags('a')).toThrow();
    expect(() => assertTags([''])).toThrow();
    expect(() => assertTags(new Array(26).fill('x'))).toThrow();
  });
});
