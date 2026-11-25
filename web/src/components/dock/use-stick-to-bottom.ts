import { useLayoutEffect, useRef, useState, type UIEvent, type WheelEvent } from 'react';

/** Scroll events this soon after the view scrolled itself are its own, even when more content landed in between. */
const OWN_SCROLL_MS = 150;
const BOTTOM_SLACK_PX = 80;

/**
 * Keeps a scroller pinned to its newest content while you are at the bottom. Only you scrolling up lets go: growth that
 * lands between the view's own scroll and its scroll event must not read as you leaving the bottom.
 */
export function useStickToBottom() {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const scrolledSelfAt = useRef(0);
  const [atBottom, setAtBottom] = useState(true);
  const settle = (v: boolean) => {
    stick.current = v;
    setAtBottom(v);
  };
  const pin = () => {
    const el = scroller.current;
    if (!el) return;
    scrolledSelfAt.current = performance.now();
    el.scrollTop = el.scrollHeight;
  };
  useLayoutEffect(() => {
    const inner = content.current;
    if (!inner) return;
    const follow = new ResizeObserver(() => stick.current && pin());
    follow.observe(inner);
    return () => follow.disconnect();
  }, []);
  return {
    scroller,
    content,
    atBottom,
    release: () => settle(false),
    toBottom: () => {
      settle(true);
      pin();
    },
    onScroll: (e: UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_SLACK_PX) settle(true);
      else if (performance.now() - scrolledSelfAt.current > OWN_SCROLL_MS) settle(false);
    },
    onWheel: (e: WheelEvent<HTMLDivElement>) => e.deltaY < 0 && settle(false),
  };
}
