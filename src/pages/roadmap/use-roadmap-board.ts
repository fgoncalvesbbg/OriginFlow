/**
 * Roadmap Creator — board state.
 *
 * One category's SKUs and every annotation on them, plus the mutations that edit them.
 *
 * Annotation edits are OPTIMISTIC: flagging a SKU or dropping a placeholder happens dozens of
 * times in a sitting, and a refetch per click would make the board feel like it was thinking.
 * Each mutation applies locally, fires the request, and on failure restores the exact snapshot it
 * took beforehand and surfaces the database's message. Imports are deliberately NOT optimistic —
 * they rewrite thousands of rows, so the board reloads from the server afterwards.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addRoadmapAxisValue,
  addRoadmapPlacer,
  clearRoadmapCategory,
  getRoadmapBoard,
  removeRoadmapAxisValue,
  removeRoadmapPlacer,
  setRoadmapFlag,
  setRoadmapFlagStatus,
  updateRoadmapPlacer,
} from '../../services';
import type {
  RoadmapAxisKind,
  RoadmapBoard,
  RoadmapFlag,
  RoadmapPlacer,
  RoadmapPlacerType,
  RoadmapStatus,
} from '../../types';

const EMPTY: RoadmapBoard = { category: '', skus: [], flags: [], placers: [], axisValues: [] };

const message = (err: unknown): string =>
  err instanceof Error ? err.message : 'Something went wrong.';

export interface UseRoadmapBoard {
  board: RoadmapBoard;
  loading: boolean;
  busy: boolean;
  error: string;
  setError: (v: string) => void;
  reload: (signal?: AbortSignal) => Promise<void>;
  setFlag: (sku: string, flag: RoadmapFlag | null, comment?: string) => Promise<unknown>;
  setFlagStatus: (
    sku: string,
    values: { status?: RoadmapStatus; approvedBy?: string | null; projectCode?: string | null },
  ) => Promise<unknown>;
  addPlacer: (input: {
    yField: string;
    xField: string;
    family: string;
    yValue: string;
    xValue: string;
    type: RoadmapPlacerType;
    comment?: string;
  }) => Promise<unknown>;
  updatePlacer: (
    id: number,
    values: {
      comment?: string;
      type?: RoadmapPlacerType;
      projectCode?: string | null;
      expected2027Nic?: number | null;
      status?: RoadmapStatus;
      approvedBy?: string | null;
    },
  ) => Promise<unknown>;
  removePlacer: (id: number) => Promise<unknown>;
  addAxisValue: (input: {
    kind: RoadmapAxisKind;
    field?: string | null;
    value: string;
  }) => Promise<unknown>;
  removeAxisValue: (id: number) => Promise<unknown>;
  clearCategory: () => Promise<unknown>;
}

export function useRoadmapBoard(category: string, actor: string | null): UseRoadmapBoard {
  const [board, setBoard] = useState<RoadmapBoard>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const reqRef = useRef(0);

  const reload = useCallback(
    async (signal?: AbortSignal) => {
      if (!category) {
        setBoard(EMPTY);
        return;
      }
      const seq = ++reqRef.current;
      setLoading(true);
      setError('');
      try {
        const data = await getRoadmapBoard(category, signal);
        // Ignore a response that arrived after a newer request was issued — switching categories
        // quickly must not leave an older board on screen.
        if (seq === reqRef.current) setBoard(data);
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
        if (seq === reqRef.current) {
          setBoard(EMPTY);
          setError(message(err));
        }
      } finally {
        if (seq === reqRef.current) setLoading(false);
      }
    },
    [category],
  );

  useEffect(() => {
    const ac = new AbortController();
    void reload(ac.signal);
    return () => ac.abort();
  }, [reload]);

  /** Apply `optimistic` immediately, run `send`, and roll the WHOLE board back if it fails. */
  const mutate = useCallback(
    async <T>(
      optimistic: (prev: RoadmapBoard) => RoadmapBoard,
      send: () => Promise<T>,
    ): Promise<T | null> => {
      let snapshot: RoadmapBoard | undefined;
      setBoard(prev => {
        snapshot = prev;
        return optimistic(prev);
      });
      setBusy(true);
      setError('');
      try {
        return await send();
      } catch (err) {
        if (snapshot) setBoard(snapshot);
        setError(message(err));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const setFlag = useCallback(
    (sku: string, flag: RoadmapFlag | null, comment?: string) => {
      const cleared = !flag && !(comment || '').trim();
      const before = board.flags.find(f => f.sku === sku) ?? null;
      return mutate(
        prev => ({
          ...prev,
          flags: cleared
            ? prev.flags.filter(f => f.sku !== sku)
            : prev.flags.some(f => f.sku === sku)
              ? prev.flags.map(f =>
                  f.sku === sku ? { ...f, flag, comment: comment || '', updatedBy: actor } : f,
                )
              : [
                  ...prev.flags,
                  {
                    sku,
                    flag,
                    comment: comment || '',
                    projectCode: '',
                    status: 'pending' as RoadmapStatus,
                    approvedBy: null,
                    updatedAt: null,
                    updatedBy: actor,
                  },
                ],
        }),
        () => setRoadmapFlag(sku, { flag, comment }, { category, before }),
      );
    },
    [board.flags, category, actor, mutate],
  );

  const setFlagStatus = useCallback(
    (
      sku: string,
      values: { status?: RoadmapStatus; approvedBy?: string | null; projectCode?: string | null },
    ) =>
      // status / approvedBy / projectCode are INDEPENDENT — the Summary tab renders them as
      // separate dropdowns, so setting one must never reset another.
      mutate(
        prev => ({
          ...prev,
          flags: prev.flags.map(f =>
            f.sku === sku
              ? {
                  ...f,
                  status: values.status ?? f.status,
                  approvedBy: values.approvedBy !== undefined ? values.approvedBy : f.approvedBy,
                  projectCode:
                    values.projectCode !== undefined ? values.projectCode || '' : f.projectCode,
                  updatedBy: actor,
                }
              : f,
          ),
        }),
        () => setRoadmapFlagStatus(sku, values),
      ),
    [actor, mutate],
  );

  const addPlacer = useCallback(
    (input: {
      yField: string;
      xField: string;
      family: string;
      yValue: string;
      xValue: string;
      type: RoadmapPlacerType;
      comment?: string;
    }) => {
      // A NEGATIVE temporary id can never collide with a real identity value, so swapping the
      // saved row in afterwards is unambiguous.
      const tempId = -Date.now();
      return mutate(
        prev => ({
          ...prev,
          placers: [
            ...prev.placers,
            {
              id: tempId,
              category,
              ...input,
              comment: input.comment || '',
              projectCode: '',
              expected2027Nic: null,
              status: 'pending' as RoadmapStatus,
              approvedBy: null,
              sortOrder: prev.placers.length,
              updatedAt: null,
              updatedBy: actor,
            },
          ],
        }),
        async () => {
          const saved = await addRoadmapPlacer({ category, ...input });
          setBoard(prev => ({
            ...prev,
            placers: prev.placers.map(p => (p.id === tempId ? saved : p)),
          }));
          return saved;
        },
      );
    },
    [category, actor, mutate],
  );

  const updatePlacer = useCallback(
    (
      id: number,
      values: {
        comment?: string;
        type?: RoadmapPlacerType;
        projectCode?: string | null;
        expected2027Nic?: number | null;
        status?: RoadmapStatus;
        approvedBy?: string | null;
      } = {},
    ) =>
      mutate(
        prev => ({
          ...prev,
          placers: prev.placers.map(p =>
            p.id === id
              ? {
                  ...p,
                  comment: values.comment ?? p.comment,
                  type: values.type ?? p.type,
                  projectCode:
                    values.projectCode !== undefined ? values.projectCode || '' : p.projectCode,
                  expected2027Nic:
                    values.expected2027Nic !== undefined
                      ? values.expected2027Nic
                      : p.expected2027Nic,
                  status: values.status ?? p.status,
                  approvedBy: values.approvedBy !== undefined ? values.approvedBy : p.approvedBy,
                  updatedBy: actor,
                }
              : p,
          ),
        }),
        () => updateRoadmapPlacer(id, values, { category }),
      ),
    [category, actor, mutate],
  );

  const removePlacer = useCallback(
    (id: number) => {
      const before = board.placers.find(p => p.id === id);
      return mutate(
        prev => ({ ...prev, placers: prev.placers.filter(p => p.id !== id) }),
        () => removeRoadmapPlacer(id, { category, before }),
      );
    },
    [board.placers, category, mutate],
  );

  const addAxisValue = useCallback(
    ({ kind, field, value }: { kind: RoadmapAxisKind; field?: string | null; value: string }) => {
      const tempId = -Date.now();
      return mutate(
        prev =>
          // Adding one that already exists is a no-op, not an error — the database's partial
          // unique indexes would reject it and the planner would see a failure for something
          // that is already true.
          prev.axisValues.some(
            a =>
              a.kind === kind &&
              a.field === (field || null) &&
              a.value.toLowerCase() === value.toLowerCase(),
          )
            ? prev
            : {
                ...prev,
                axisValues: [
                  ...prev.axisValues,
                  { id: tempId, kind, category, field: field || null, value, createdBy: actor },
                ],
              },
        async () => {
          const saved = await addRoadmapAxisValue({ kind, category, field, value });
          setBoard(prev => ({
            ...prev,
            axisValues: prev.axisValues.some(a => a.id === saved.id)
              ? prev.axisValues.filter(a => a.id !== tempId)
              : prev.axisValues.map(a => (a.id === tempId ? saved : a)),
          }));
          return saved;
        },
      );
    },
    [category, actor, mutate],
  );

  const removeAxisValue = useCallback(
    (id: number) => {
      const before = board.axisValues.find(a => a.id === id);
      return mutate(
        prev => ({ ...prev, axisValues: prev.axisValues.filter(a => a.id !== id) }),
        () => removeRoadmapAxisValue(id, { category, before }),
      );
    },
    [board.axisValues, category, mutate],
  );

  const clearCategory = useCallback(
    () =>
      mutate(
        prev => ({ ...prev, flags: [], placers: [] }),
        () => clearRoadmapCategory(category),
      ),
    [category, mutate],
  );

  return {
    board,
    loading,
    busy,
    error,
    setError,
    reload,
    setFlag,
    setFlagStatus,
    addPlacer,
    updatePlacer,
    removePlacer,
    addAxisValue,
    removeAxisValue,
    clearCategory,
  };
}
