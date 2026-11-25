import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { connect } from "./backend.ts";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);

connect().then((backend) =>
  root.render(
    <StrictMode>
      <App backend={backend} />
    </StrictMode>,
  ),
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
}
