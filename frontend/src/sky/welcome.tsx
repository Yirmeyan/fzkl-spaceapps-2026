import { createRoot } from "react-dom/client";
import { WelcomeWindow } from "../ui/WelcomeWindow";

/**
 * The welcome window of the explorer, shown over the sky map. The map is plain DOM: React
 * is loaded for this window only, and only when the window opens.
 */
export function showWelcome(onClose: () => void, onTour: () => void): void {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const leave = (then: () => void) => () => {
    root.unmount();
    host.remove();
    then();
  };
  root.render(<WelcomeWindow onClose={leave(onClose)} onTour={leave(onTour)} />);
}
