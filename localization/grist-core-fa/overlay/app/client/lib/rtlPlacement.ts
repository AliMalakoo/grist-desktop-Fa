/**
 * Mirroring popper.js placements for the right-to-left interface.
 *
 * Popper (v1, via popweasel) has no notion of text direction: `bottom-start` means "the popup's
 * left edge hugs the trigger's left edge", always. For a Persian trigger sitting at the right edge
 * of the screen that anchors the popup to the far side of the trigger, hanging it off the start of
 * the window. Persian drops menus from the reading edge -- the same edge the trigger's label
 * starts from -- so the `start`/`end` and `left`/`right` sides swap when the interface is RTL.
 *
 * `top` and `bottom` have no horizontal side and pass through unchanged.
 */
import { isRtlInterface } from "app/client/lib/localization";

import {
  IPopupDomCreator,
  IPopupFunc,
  IPopupOptions,
  PopupControl,
  setPopupToCreateDom,
  setPopupToFunc,
} from "popweasel";

const SIDE_FLIP: { readonly [side: string]: string } = {
  left: "right",
  right: "left",
};

/**
 * Returns `placement`, or its mirror image when the interface is RTL: `bottom-start` becomes
 * `bottom-end`, `right-start` becomes `left-start`, and so on. Placements without a horizontal
 * component are returned unchanged.
 */
export function rtlPlacement<P extends string | undefined>(placement: P): P {
  if (!placement || !isRtlInterface()) { return placement; }
  const [main, sub] = placement.split("-");
  const flippedMain = SIDE_FLIP[main] ?? main;
  const flippedSub = sub === undefined ?
    "" :
    sub === "start" ? "-end" :
    sub === "end" ? "-start" :
    `-${sub}`;
  return (flippedMain + flippedSub) as P;
}

/**
 * `setPopupToCreateDom` with the popup mirrored for the RTL interface. Kept next to
 * `rtlPlacement` so call sites do not each have to remember the rule.
 */
export function rtlSetPopupToCreateDom(
  triggerElem: Element,
  domCreator: IPopupDomCreator,
  options: IPopupOptions,
): PopupControl {
  const opts = { ...options };
  if (opts.placement) { opts.placement = rtlPlacement(opts.placement); }
  return setPopupToCreateDom(triggerElem, domCreator, opts);
}

/** `setPopupToFunc` with the popup mirrored for the RTL interface. */
export function rtlSetPopupToFunc<T extends IPopupOptions = IPopupOptions>(
  triggerElem: Element,
  openFunc: IPopupFunc<T>,
  options: T,
): PopupControl<T> {
  const opts = { ...options };
  if (opts.placement) { opts.placement = rtlPlacement(opts.placement); }
  return setPopupToFunc(triggerElem, openFunc, opts);
}
