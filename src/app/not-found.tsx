import type { Metadata } from "next";
import NotFoundLoader from "../components/not-found/NotFoundLoader";

export const metadata: Metadata = {
  title: "404 - Page not found | Budget Tracker",
};

// Rendered for every unmatched URL. With `output: 'export'` Next writes this
// as dist/404.html, which static hosts serve for unknown paths. It sits
// outside the (main) route group, so it never boots the database SharedWorker.
export default function NotFound() {
  return <NotFoundLoader />;
}
