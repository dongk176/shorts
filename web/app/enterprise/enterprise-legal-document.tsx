import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { LegalDocument, LegalSection } from "@/components/legal-document";

type EnterpriseLegalKind = "purchase-terms" | "refund-policy";

function inline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, index) => {
    const strong = /^\*\*(.+)\*\*$/.exec(part);
    if (strong) return <strong key={index}>{strong[1]}</strong>;
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) return <a key={index} href={link[2]} className="font-bold text-sky-200 underline underline-offset-4">{link[1]}</a>;
    return part;
  });
}

function blocks(markdown: string) {
  const lines = markdown.split("\n");
  const content = lines.slice(5);
  const result: ReactNode[] = [];
  let sectionTitle = "안내";
  let sectionChildren: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: Array<{ ordered: boolean; text: string }> = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const value = paragraph.join(" ");
    sectionChildren.push(<p key={`p-${result.length}-${sectionChildren.length}`}>{inline(value)}</p>);
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    const ordered = list[0].ordered;
    const List = ordered ? "ol" : "ul";
    sectionChildren.push(
      <List key={`l-${result.length}-${sectionChildren.length}`} className={`${ordered ? "list-decimal" : "list-disc"} space-y-1 pl-6`}>
        {list.map((item, index) => <li key={index}>{inline(item.text)}</li>)}
      </List>,
    );
    list = [];
  };
  const flushSection = () => {
    flushParagraph();
    flushList();
    if (!sectionChildren.length) return;
    result.push(<LegalSection key={`${sectionTitle}-${result.length}`} title={sectionTitle}>{sectionChildren}</LegalSection>);
    sectionChildren = [];
  };

  for (const raw of content) {
    const line = raw.trim();
    const heading = /^#{2,3}\s+(.+)$/.exec(line);
    if (heading) {
      flushSection();
      sectionTitle = heading[1];
      continue;
    }
    const ordered = /^\d+\.\s+(.+)$/.exec(line);
    const bullet = /^\*\s+(.+)$/.exec(line);
    if (ordered || bullet) {
      flushParagraph();
      list.push({ ordered: Boolean(ordered), text: (ordered || bullet)![1] });
      continue;
    }
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    paragraph.push(line);
  }
  flushSection();
  return result;
}

export function EnterpriseLegalDocument({ kind }: { kind: EnterpriseLegalKind }) {
  const filename = kind === "purchase-terms"
    ? "purchase-terms-v1.md"
    : "refund-policy-v1.md";
  const markdown = readFileSync(
    join(process.cwd(), "content", "enterprise", filename),
    "utf8",
  );
  const lines = markdown.split("\n");
  const title = lines[0].replace(/^#\s+/, "");
  const effectiveDate = lines[2].replaceAll("**", "").replace("시행일: ", "");
  const description = lines[5];
  return (
    <LegalDocument
      eyebrow="Enterprise Legal"
      title={title}
      description={description}
      effectiveDate={effectiveDate}
      showTranslationNotice={false}
      preventTextSelection={false}
    >
      {blocks(markdown)}
    </LegalDocument>
  );
}
