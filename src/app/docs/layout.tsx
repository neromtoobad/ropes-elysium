import { Sidebar } from "./Sidebar";
import { DocsHeader, DocsFooter } from "./DocsChrome";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="docs">
      <DocsHeader section="Docs" />
      <div className="docs-body">
        <Sidebar />
        <div className="docs-main">{children}</div>
      </div>
      <DocsFooter />
    </div>
  );
}
