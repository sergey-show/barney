import { useEffect, useState } from "react";

export const PAGE_SIZE = 20;

export function pageSlice<T>(items: T[], page: number, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(items.length / size) || 1);
  const current = Math.min(Math.max(0, page), pages - 1);
  return { current, pages, slice: items.slice(current * size, current * size + size) };
}

export function usePager<T>(items: T[], size = PAGE_SIZE) {
  const [page, setPage] = useState(0);
  const next = pageSlice(items, page, size);
  useEffect(() => {
    if (page !== next.current) setPage(next.current);
  }, [page, next.current]);
  return { ...next, setPage };
}

export function Pager(props: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
  prev: string;
  next: string;
}) {
  if (props.pages <= 1) return null;
  return (
    <div className="pager">
      <button type="button" className="item" disabled={props.page <= 0} onClick={() => props.onPage(props.page - 1)}>
        {props.prev}
      </button>
      <span className="pager-pos">{props.page + 1} / {props.pages}</span>
      <button type="button" className="item" disabled={props.page + 1 >= props.pages} onClick={() => props.onPage(props.page + 1)}>
        {props.next}
      </button>
    </div>
  );
}
