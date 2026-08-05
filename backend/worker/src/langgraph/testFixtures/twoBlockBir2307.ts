import {
  degrees,
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFPage,
} from "pdf-lib";

export interface TwoBlockBir2307FixtureOptions {
  payorPrintedName?: string | null;
  payorTitle?: string | null;
  payorTin?: string | null;
  payorSigned?: boolean;
  payeePrintedName?: string | null;
  payeeSigned?: boolean;
  pageSize?: "letter" | "a4" | "tall";
  rotationDegrees?: 90 | 180 | 270;
  stackedPayorIdentity?: boolean;
}

function drawSignature(page: PDFPage, input: { x: number; y: number }) {
  const black = rgb(0, 0, 0);
  page.drawLine({
    start: { x: input.x, y: input.y + 4 },
    end: { x: input.x + 42, y: input.y + 26 },
    thickness: 1.7,
    color: black,
  });
  page.drawLine({
    start: { x: input.x + 42, y: input.y + 26 },
    end: { x: input.x + 96, y: input.y + 2 },
    thickness: 1.7,
    color: black,
  });
  page.drawLine({
    start: { x: input.x + 96, y: input.y + 2 },
    end: { x: input.x + 148, y: input.y + 22 },
    thickness: 1.7,
    color: black,
  });
}

export async function buildTwoBlockBir2307Fixture(
  options: TwoBlockBir2307FixtureOptions = {},
): Promise<Buffer> {
  const size =
    options.pageSize === "a4"
      ? ([595.28, 841.89] as const)
      : options.pageSize === "tall"
        ? ([612, 1008] as const)
        : ([612, 792] as const);
  const scale = size[1] / 792;
  const document = await PDFDocument.create();
  const page = document.addPage([...size]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const black = rgb(0, 0, 0);
  const y = (letterY: number) => letterY * scale;

  page.drawText("BIR Form No. 2307", {
    x: 44,
    y: y(724),
    size: 12,
    font,
    color: black,
  });
  page.drawText("Certificate of Creditable Tax Withheld at Source", {
    x: 184,
    y: y(724),
    size: 11,
    font,
    color: black,
  });
  page.drawText(
    "We declare under the penalties of perjury that this certificate has been made in good faith.",
    {
      x: 42,
      y: y(188),
      size: 7,
      font,
      color: black,
    },
  );

  const payorName =
    options.payorPrintedName === undefined
      ? "PAYOR SIGNER"
      : options.payorPrintedName;
  const payorTitle =
    options.payorTitle === undefined ? "Finance Manager" : options.payorTitle;
  const payorTin =
    options.payorTin === undefined ? "901-327-847-000" : options.payorTin;
  const payorNameY = options.stackedPayorIdentity ? 169 : 142;
  const payorTitleY = options.stackedPayorIdentity ? 161 : 142;
  const payorTinY = options.stackedPayorIdentity ? 145 : 142;
  if (payorName) {
    page.drawText(payorName, {
      x: 86,
      y: y(payorNameY),
      size: 10,
      font,
      color: black,
    });
  }
  if (payorTitle) {
    page.drawText(payorTitle, {
      x: 316,
      y: y(payorTitleY),
      size: 9,
      font,
      color: black,
    });
  }
  if (payorTin) {
    page.drawText(payorTin, {
      x: 462,
      y: y(payorTinY),
      size: 9,
      font,
      color: black,
    });
  }
  if (options.payorSigned ?? true) {
    drawSignature(page, { x: 104, y: y(148) });
  }

  page.drawLine({
    start: { x: 38, y: y(130) },
    end: { x: size[0] - 38, y: y(130) },
    thickness: 0.8,
    color: black,
  });
  page.drawText(
    "Signature over Printed Name of Payor/Payor's Authorized Representative/Tax Agent",
    {
      x: 100,
      y: y(116),
      size: 6.8,
      font,
      color: black,
    },
  );
  page.drawText("(Indicate Title/Designation and TIN)", {
    x: 340,
    y: y(106),
    size: 6.8,
    font,
    color: black,
  });

  const accreditationTopY = options.stackedPayorIdentity ? 110 : 98;
  const accreditationBottomY = options.stackedPayorIdentity ? 90 : 78;
  for (const lineY of [accreditationTopY, accreditationBottomY]) {
    page.drawLine({
      start: { x: 38, y: y(lineY) },
      end: { x: size[0] - 38, y: y(lineY) },
      thickness: 0.8,
      color: black,
    });
  }
  for (const x of [38, 104, 170, 236, 302, 368, 434, size[0] - 38]) {
    page.drawLine({
      start: { x, y: y(accreditationBottomY) },
      end: { x, y: y(accreditationTopY) },
      thickness: 0.8,
      color: black,
    });
  }
  page.drawText("Tax Agent Accreditation No.", {
    x: 42,
    y: y(options.stackedPayorIdentity ? 96 : 84),
    size: 6.5,
    font,
    color: black,
  });

  page.drawText("CONFORME", {
    x: 42,
    y: y(options.stackedPayorIdentity ? 77 : 65),
    size: 7,
    font,
    color: black,
  });
  const payeeName =
    options.payeePrintedName === undefined
      ? "PAYEE SIGNER"
      : options.payeePrintedName;
  if (payeeName) {
    page.drawText(payeeName, {
      x: 88,
      y: y(42),
      size: 10,
      font,
      color: black,
    });
  }
  if (options.payeeSigned) {
    drawSignature(page, { x: 104, y: y(48) });
  }
  page.drawLine({
    start: { x: 38, y: y(34) },
    end: { x: size[0] - 38, y: y(34) },
    thickness: 0.8,
    color: black,
  });
  page.drawText("Signature over Printed Name of Payee", {
    x: 180,
    y: y(22),
    size: 6.8,
    font,
    color: black,
  });

  if (options.rotationDegrees) {
    page.setRotation(degrees(options.rotationDegrees));
  }
  return Buffer.from(await document.save());
}
