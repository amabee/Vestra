import { memo, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer, useWindowVirtualizer } from "@tanstack/react-virtual";
import { Link } from "react-router";
import { mediaKey, type MediaItem } from "@vestra/types";
import { ScreenPoster } from "./screen-poster";

/** Fixed card geometry keeps scroll height stable as posters decode. */
export const ScreenTitleGrid = memo(function ScreenTitleGrid({
  items,
}: {
  items: MediaItem[];
}) {
  const host = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({
    columns: 1,
    cardHeight: 340,
    columnGap: 20,
    rowGap: 28,
    margin: 0,
    scroller: null as HTMLElement | null,
  });
  useLayoutEffect(() => {
    const node = host.current;
    if (!node) return;
    const measure = () => {
      const scroller = node.closest("main");
      const rem = parseFloat(
        getComputedStyle(document.documentElement).fontSize,
      );
      const compact = window.matchMedia("(max-width:480px)").matches;
      const columnGap = rem * (compact ? 0.8 : 1.25);
      const rowGap = rem * (compact ? 1.25 : 1.75);
      const width = node.clientWidth;
      const columns = compact
        ? 2
        : Math.max(1, Math.floor((width + columnGap) / (155 + columnGap)));
      const cardWidth = (width - columnGap * (columns - 1)) / columns;
      const margin =
        node.getBoundingClientRect().top -
        (scroller?.getBoundingClientRect().top ?? 0) +
        (scroller?.scrollTop ?? window.scrollY);
      const next = {
        columns,
        cardHeight: cardWidth * 1.5 + rem * 4.735,
        columnGap,
        rowGap,
        margin,
        scroller,
      };
      setLayout((old) =>
        Object.keys(next).every(
          (key) =>
            old[key as keyof typeof old] === next[key as keyof typeof next],
        )
          ? old
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    if (node.parentElement) observer.observe(node.parentElement);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const options = {
    count: Math.ceil(items.length / layout.columns),
    estimateSize: () => layout.cardHeight,
    overscan: 3,
    gap: layout.rowGap,
    scrollMargin: layout.margin,
  };
  const elementRows = useVirtualizer({
    ...options,
    getScrollElement: () => layout.scroller,
    enabled: !!layout.scroller,
  });
  const windowRows = useWindowVirtualizer({
    ...options,
    enabled: !layout.scroller,
  });
  const rows = layout.scroller ? elementRows : windowRows;
  useLayoutEffect(() => {
    elementRows.measure();
    windowRows.measure();
  }, [layout.cardHeight, layout.columns, elementRows, windowRows]);
  return (
    <div
      ref={host}
      className="screen-virtual-grid"
      aria-label="Titles"
      data-total-titles={items.length}
      style={{ height: rows.getTotalSize() }}
    >
      {rows.getVirtualItems().map((row) => (
        <div
          key={row.key}
          className="screen-grid screen-virtual-row"
          style={{
            height: layout.cardHeight,
            gridTemplateColumns: `repeat(${layout.columns},minmax(0,1fr))`,
            columnGap: layout.columnGap,
            transform: `translateY(${row.start - layout.margin}px)`,
          }}
        >
          {items
            .slice(row.index * layout.columns, (row.index + 1) * layout.columns)
            .map((item) => (
              <ScreenTitleCard key={mediaKey(item)} item={item} />
            ))}
        </div>
      ))}
    </div>
  );
});
const ScreenTitleCard = memo(function ScreenTitleCard({
  item,
}: {
  item: MediaItem;
}) {
  return (
    <Link
      className="screen-card"
      title={item.title}
      to={`/media/${encodeURIComponent(item.source)}/${item.kind}/${encodeURIComponent(item.sourceId)}`}
    >
      <div className="screen-poster">
        <ScreenPoster item={item} />
      </div>
      <h2>{item.title}</h2>
      <p>
        {item.year ?? "Year unknown"} /{" "}
        {item.kind === "movie" ? "Movie" : "TV series"}
      </p>
    </Link>
  );
});
