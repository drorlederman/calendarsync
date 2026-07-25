import type { CSSProperties } from "react";

export const OUT_OF_WINDOW_LABEL = "אין נתונים";
export const OUT_OF_WINDOW_TITLE = "מחוץ לטווח המסונכרן — אין נתונים שמורים ליום זה";

/** Diagonal hatch marking a day the sync window never fetched. */
export const outOfWindowStyle: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, #F4F6FA, #F4F6FA 6px, #FFFFFF 6px, #FFFFFF 12px)",
};
