import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

export interface ParsedChapter {
  index: number;
  title: string;
  content: string; // sanitized-ish HTML
}

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

/**
 * Bir .epub dosyasını (Buffer/Uint8Array) OPF spine sırasına göre böler.
 * eptran'ın ürettiği epub'lar standart EPUB2/3 yapısında olduğu için
 * container.xml -> content.opf -> manifest+spine akışını takip ediyoruz.
 */
export async function parseEpub(fileBuffer: ArrayBuffer): Promise<ParsedChapter[]> {
  const zip = await JSZip.loadAsync(fileBuffer);

  const containerXml = await zip.file("META-INF/container.xml")?.async("string");
  if (!containerXml) throw new Error("container.xml bulunamadı, geçersiz epub");
  const container = xml.parse(containerXml);
  const opfPath: string =
    container.container.rootfiles.rootfile["@_full-path"];

  const opfXmlRaw = await zip.file(opfPath)?.async("string");
  if (!opfXmlRaw) throw new Error(`OPF dosyası bulunamadı: ${opfPath}`);
  const opf = xml.parse(opfXmlRaw);

  const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";

  const manifestItems: any[] = Array.isArray(opf.package.manifest.item)
    ? opf.package.manifest.item
    : [opf.package.manifest.item];
  const manifestById = new Map(manifestItems.map((it) => [it["@_id"], it]));

  const spineItems: any[] = Array.isArray(opf.package.spine.itemref)
    ? opf.package.spine.itemref
    : [opf.package.spine.itemref];

  const chapters: ParsedChapter[] = [];

  for (let i = 0; i < spineItems.length; i++) {
    const idref = spineItems[i]["@_idref"];
    const manifestItem = manifestById.get(idref);
    if (!manifestItem) continue;

    const href = opfDir + manifestItem["@_href"];
    const file = zip.file(href);
    if (!file) continue;

    const rawHtml = await file.async("string");
    const { title, content } = extractTitleAndBody(rawHtml, i);

    chapters.push({ index: i, title, content });
  }

  return chapters;
}

/** XHTML gövdesinden <body> içeriğini ve olası bir başlığı çıkarır. */
function extractTitleAndBody(rawHtml: string, fallbackIndex: number) {
  const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1] : rawHtml;

  const headingMatch = body.match(/<h[1-3][^>]*>(.*?)<\/h[1-3]>/i);
  const title = headingMatch
    ? headingMatch[1].replace(/<[^>]+>/g, "").trim()
    : `Bölüm ${fallbackIndex + 1}`;

  return { title, content: sanitizeHtml(body) };
}

/**
 * eptran çıktısı zaten kendi kontrolümüzdeki bir pipeline'dan geliyor
 * (kullanıcı harici epub yüklemiyor) ama yine de script/style/on* gibi
 * tehlikeli parçaları temizliyoruz.
 */
function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "");
}

/**
 * eptran'ın "001_kitap-adi.txt", "002_kitap-adi.txt" ... formatındaki
 * fallback çıktısı için basit paragraf bölme.
 */
export function parseTxtChapter(fileName: string, text: string, index: number): ParsedChapter {
  const firstLine = text.split("\n").find((l) => l.trim().length > 0) ?? `Bölüm ${index + 1}`;
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("\n");

  return { index, title: firstLine.slice(0, 120), content: paragraphs };
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
