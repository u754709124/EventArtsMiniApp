import type { AnyRecord } from "../forms/form-utils";
import { request } from "../api";

type ListResponse = {
  items: AnyRecord[];
  total?: number;
};

export type CrudDefaultValues = AnyRecord | (() => AnyRecord);

export function resolveCrudDefaultValues(defaultValues?: CrudDefaultValues): AnyRecord {
  return typeof defaultValues === "function" ? defaultValues() : (defaultValues ?? {});
}

export function nextSortDefaults(records: readonly AnyRecord[], fields: readonly string[] = ["sortOrder"]) {
  return Object.fromEntries(fields.map((field) => {
    const maximum = records.reduce((current, record) => {
      const value = Number(record[field]);
      return Number.isSafeInteger(value) && value >= 0 ? Math.max(current, value) : current;
    }, 0);
    return [field, maximum + 1];
  }));
}

export function createCrudFormDefaults(
  records: readonly AnyRecord[],
  defaultValues?: CrudDefaultValues,
  sortFields: readonly string[] = ["sortOrder"]
): AnyRecord {
  return {
    status: "enabled",
    isFeatured: false,
    detailPageId: null,
    ...nextSortDefaults(records, sortFields),
    ...resolveCrudDefaultValues(defaultValues)
  };
}

function listPath(path: string, page: number) {
  return `${path}${path.includes("?") ? "&" : "?"}page=${page}&pageSize=100`;
}

export async function loadAllCrudRecords(path: string) {
  const first = await request<ListResponse>(listPath(path, 1));
  const total = first.total ?? first.items.length;
  const records = [...first.items];
  for (let page = 2; records.length < total; page += 1) {
    const next = await request<ListResponse>(listPath(path, page));
    if (!next.items.length) break;
    records.push(...next.items);
  }
  return records;
}
