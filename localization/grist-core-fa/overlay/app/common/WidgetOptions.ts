import { NumberFormatOptions } from "app/common/NumberFormat";

export interface WidgetOptions extends NumberFormatOptions {
  textColor?: "string";
  fillColor?: "string";
  alignment?: "left" | "center" | "right";
  dateFormat?: string;
  timeFormat?: string;
  /** Show and read Date/DateTime values on the Jalali (Persian solar) calendar. */
  jalali?: boolean;
  widget?: "HyperLink";
  choices?: string[];
}
