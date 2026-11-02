import { createContext, useContext } from "react";

/** False while a tool's tab is in the background. Its panel stays mounted, so clocks and timers should pause. */
export const ToolActiveContext = createContext(true);

export const useToolActive = () => useContext(ToolActiveContext);
