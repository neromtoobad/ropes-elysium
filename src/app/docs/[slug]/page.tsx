import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { loadDoc } from "@/docs/load";
import { PAGES } from "@/docs/nav";

export const dynamicParams = false;

export function generateStaticParams() {
  return PAGES.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const d = loadDoc(slug);
  if (!d) return {};
  return { title: `${d.title} · ROPES Docs`, description: d.description, openGraph: { title: `${d.title} · ROPES Docs`, description: d.description } };
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const d = loadDoc(slug);
  if (!d) notFound();
  const i = PAGES.findIndex((p) => p.slug === slug);
  const prev = PAGES[i - 1], next = PAGES[i + 1];
  return (
    <div className="docs-page">
      <article className="doc">
        <h1>{d.title}</h1>
        <p className="doc-lede">{d.description}</p>
        <div dangerouslySetInnerHTML={{ __html: d.html }} />
        <div className="doc-pager">
          {prev ? <Link href={`/docs/${prev.slug}`}><small>Previous</small>{prev.title}</Link> : <span />}
          {next ? <Link href={`/docs/${next.slug}`} className="next"><small>Next</small>{next.title}</Link> : <span />}
        </div>
      </article>
      {d.toc.length > 1 && (
        <aside className="doc-toc">
          <p>On this page</p>
          {d.toc.map((t) => <a key={t.id} href={`#${t.id}`}>{t.text}</a>)}
        </aside>
      )}
    </div>
  );
}
