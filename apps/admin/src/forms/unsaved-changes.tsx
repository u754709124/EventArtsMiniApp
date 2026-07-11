import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useBlocker } from "react-router-dom";

type DirtyEntry = {
  key: string;
  message: string;
};

type UnsavedChangesContextValue = {
  dirty: boolean;
  message: string;
  setDirtyEntry: (entry: DirtyEntry, dirty: boolean) => void;
  clearDirtyEntry: (key: string) => void;
  confirmIfDirty: () => boolean;
};

const defaultMessage = "存在未保存修改，确认离开当前页面？";
const UnsavedChangesContext = createContext<UnsavedChangesContextValue | null>(null);

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<DirtyEntry[]>([]);
  const dirty = entries.length > 0;
  const message = entries.at(-1)?.message ?? defaultMessage;
  const blocker = useBlocker(dirty);
  const setDirtyEntry = useCallback((entry: DirtyEntry, isDirty: boolean) => {
    setEntries((current) => {
      const existing = current.find((item) => item.key === entry.key);
      if (isDirty && existing?.message === entry.message) return current;
      const rest = current.filter((item) => item.key !== entry.key);
      if (!isDirty) return rest.length === current.length ? current : rest;
      return [...rest, entry];
    });
  }, []);
  const clearDirtyEntry = useCallback((key: string) => {
    setEntries((current) => {
      const rest = current.filter((item) => item.key !== key);
      return rest.length === current.length ? current : rest;
    });
  }, []);

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm(message)) {
      setEntries([]);
      blocker.proceed();
    } else {
      blocker.reset();
    }
  }, [blocker, message]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  const value = useMemo<UnsavedChangesContextValue>(() => ({
    dirty,
    message,
    setDirtyEntry,
    clearDirtyEntry,
    confirmIfDirty() {
      if (!dirty) return true;
      const confirmed = window.confirm(message);
      if (confirmed) setEntries([]);
      return confirmed;
    }
  }), [clearDirtyEntry, dirty, message, setDirtyEntry]);

  return <UnsavedChangesContext.Provider value={value}>{children}</UnsavedChangesContext.Provider>;
}

export function useUnsavedChanges() {
  const context = useContext(UnsavedChangesContext);
  if (!context) throw new Error("useUnsavedChanges must be used inside UnsavedChangesProvider");
  return context;
}

export function useDirtyFormGuard(key: string, dirty: boolean, message = defaultMessage) {
  const guard = useUnsavedChanges();
  useEffect(() => {
    guard.setDirtyEntry({ key, message }, dirty);
    return () => guard.clearDirtyEntry(key);
  }, [dirty, guard, key, message]);
  return guard;
}
