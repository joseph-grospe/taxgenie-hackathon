import { PDFDocument } from "pdf-lib";

const DETERMINISTIC_PAGE_METADATA_DATE = new Date(
  "2000-01-01T00:00:00.000Z",
);

export interface SplitPdfPage {
  pageNumber: number;
  content: Buffer;
}

function setDeterministicMetadata(document: PDFDocument): void {
  document.setCreationDate(DETERMINISTIC_PAGE_METADATA_DATE);
  document.setModificationDate(DETERMINISTIC_PAGE_METADATA_DATE);
  document.setCreator("TaxTrack");
  document.setProducer("TaxTrack");
}

export async function splitPdfPages(source: Buffer): Promise<SplitPdfPage[]> {
  const document = await PDFDocument.load(source, { ignoreEncryption: true });
  const pages: SplitPdfPage[] = [];
  for (let index = 0; index < document.getPageCount(); index += 1) {
    const split = await PDFDocument.create();
    setDeterministicMetadata(split);
    const [page] = await split.copyPages(document, [index]);
    split.addPage(page);
    pages.push({
      pageNumber: index + 1,
      content: Buffer.from(await split.save()),
    });
  }
  return pages;
}

export async function selectPdfPages(
  source: Buffer,
  pageNumbers: number[],
): Promise<Buffer> {
  if (pageNumbers.length === 0) {
    throw new Error("At least one page is required.");
  }
  const document = await PDFDocument.load(source, { ignoreEncryption: true });
  const selected = await PDFDocument.create();
  setDeterministicMetadata(selected);
  const copied = await selected.copyPages(
    document,
    pageNumbers.map((pageNumber) => pageNumber - 1),
  );
  for (const page of copied) {
    selected.addPage(page);
  }
  return Buffer.from(await selected.save());
}
