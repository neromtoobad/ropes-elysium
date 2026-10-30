import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { LESSONS, lessonBySlug } from "@/lib/lessons";
import LessonView from "./LessonView";

export const dynamicParams = false;

export function generateStaticParams() {
  return LESSONS.map((l) => ({ slug: l.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const l = lessonBySlug((await params).slug);
  if (!l) return {};
  const title = `${l.title} · Learn ROPES`;
  return { title, description: l.sub, openGraph: { title, description: l.sub, images: ["/og/og-home.png"] } };
}

export default async function LessonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!lessonBySlug(slug)) notFound();
  return <LessonView slug={slug} />;
}
