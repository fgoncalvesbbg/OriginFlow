import { describe, it, expect } from 'vitest';
import {
  DESIGN_REVIEW_PHASE, DESIGN_FINAL_PHASE, phaseStep,
} from './supplier-portal-phases';
import { isRoundClosed } from '../types/design-spec.types';
import type { SupplierDesignSpecRound } from '../types/design-spec.types';

const STANDARD = [{ stepNumber: 1 }, { stepNumber: 2 }, { stepNumber: 3 }];

describe('phaseStep', () => {
  it('uses the named phase when the project has it', () => {
    expect(phaseStep(STANDARD, DESIGN_REVIEW_PHASE)).toBe(2);
    expect(phaseStep(STANDARD, DESIGN_FINAL_PHASE)).toBe(3);
  });

  it('falls back to the last phase of a shortened template', () => {
    // The failure this prevents: a two-phase project showing no issued spec at all, which
    // hides the one document the factory has to build to.
    expect(phaseStep([{ stepNumber: 1 }, { stepNumber: 2 }], DESIGN_FINAL_PHASE)).toBe(2);
  });

  it('reads the last phase from the numbers, not from the array order', () => {
    expect(phaseStep([{ stepNumber: 5 }, { stepNumber: 1 }], DESIGN_FINAL_PHASE)).toBe(5);
  });

  it('returns null for a project with no phases, where there is no list to hang a block on', () => {
    expect(phaseStep([], DESIGN_FINAL_PHASE)).toBeNull();
  });

  it('does not collapse the two blocks onto one phase in the standard template', () => {
    expect(phaseStep(STANDARD, DESIGN_REVIEW_PHASE))
      .not.toBe(phaseStep(STANDARD, DESIGN_FINAL_PHASE));
  });
});

const round = (over: Partial<SupplierDesignSpecRound> = {}): SupplierDesignSpecRound => ({
  shareId: 's1', token: 't1', label: 'Factory A',
  sentAt: '2026-09-01T00:00:00Z',
  expiresAt: null, revokedAt: null, submittedAt: null, submittedBy: null,
  specId: 'spec', specCode: 'DS-0001', specTitle: 'Kettle',
  versionId: 'v1', version: 1, versionKind: 'draft', versionNote: null, pageCount: 12,
  projectId: 'p1', projectName: 'Kettle 1.7L',
  ...over,
});

describe('isRoundClosed', () => {
  const now = new Date('2026-09-10T00:00:00Z');

  it('is open with no expiry and no revocation', () => {
    expect(isRoundClosed(round(), now)).toBe(false);
  });

  it('is closed once revoked', () => {
    expect(isRoundClosed(round({ revokedAt: '2026-09-05T00:00:00Z' }), now)).toBe(true);
  });

  it('is closed past its expiry', () => {
    expect(isRoundClosed(round({ expiresAt: '2026-09-09T00:00:00Z' }), now)).toBe(true);
  });

  it('is still open before its expiry', () => {
    expect(isRoundClosed(round({ expiresAt: '2026-09-30T00:00:00Z' }), now)).toBe(false);
  });

  it('stays OPEN after being submitted', () => {
    // The review portal tells the reviewer "you can still add notes" to their face. Greying
    // the round out here would take the document away from the person who just read it and
    // contradict the page they would land on.
    expect(isRoundClosed(round({ submittedAt: '2026-09-08T00:00:00Z' }), now)).toBe(false);
  });

  it('is closed when a submitted round has also been revoked', () => {
    expect(isRoundClosed(
      round({ submittedAt: '2026-09-08T00:00:00Z', revokedAt: '2026-09-09T00:00:00Z' }),
      now,
    )).toBe(true);
  });
});
