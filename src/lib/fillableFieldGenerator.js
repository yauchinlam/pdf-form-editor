import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const targetFieldLabels = [
  ["Last Name", [], "text"],
  ["First Name", [], "text"],
  ["Middle Initial"],
  ["Social Security Number", ["SSN", "Social Security No"]],
  ["Date of Birth", ["DOB", "Birth Date"], "date"],
  ["Sex", [], "choiceLabel"],
  ["Home Phone Number", ["Home Phone"]],
  ["Work Phone Number", ["Work Phone"]],
  ["Mobile Phone Number", ["Mobile Phone", "Cell Phone"]],
  ["Email Address", ["Email", "E-mail Address"]],
  ["Height"],
  ["Weight"],
  ["Language Preference"],
  ["Permanent Residence Street Address", ["Residence Street Address", "Street Address"]],
  ["Apt #", ["Apartment", "Apt", "Suite"]],
  ["City"],
  ["County"],
  ["State"],
  ["Zip Code", ["ZIP", "Postal Code"]],
  ["Mailing Address"],
  ["Requested Effective Date of Coverage", ["Effective Date", "Coverage Effective Date"], "date"],
  ["Date of Hire", ["Hire Date"], "date"],
  ["Group Name/Policy Number", ["Group Name", "Policy Number"]],
  ["Position/Title", ["Position", "Title"]],
  ["Hours Worked per week", ["Hours Worked", "Hours per week"]],
  ["Salary $", ["Salary", "Annual Salary"]],
  ["Employer Group Name"],
  ["Employer Group ID"],
  ["Branch ID"],
  ["Agent Name/ID number", ["Agent Name", "Agent ID"]],
  ["National Producer Number", ["Producer Number", "NPN"]],
  ["Medicare Number"],
  ["Bank Routing Number", ["Routing Number"]],
  ["Bank Account Number", ["Account Number"]],
  ["Account Holder Name"],
  ["Primary Care Provider Name", ["Provider Name", "PCP Name"]],
  ["Provider/PCP number", ["Provider Number", "PCP Number"]],
  ["Primary Care Dentist Name", ["Dentist Name"]],
  ["Primary Care Dentist ID", ["Dentist ID"]],
  ["Life Insurance Beneficiary Full Name", ["Beneficiary Full Name", "Beneficiary Name"]],
  ["Beneficiary Relationship", ["Relationship"]],
  ["Prior medical carrier name", ["Prior Carrier", "Prior medical carrier"]],
  ["Prior Member number", ["Prior Member #"]],
  ["Prior Group number", ["Prior Group #"]],
  ["RxBin", ["Rx BIN"]],
  ["RxPCN", ["Rx PCN"]],
  ["Other insurance carrier name", ["Other carrier name"]],
  ["Other policyholder name"],
  ["Other policyholder DOB", [], "date"],
  ["Care Facility Name"],
  ["Care Facility Address"],
  ["Care Facility Date moved in", ["Date moved in"], "date"],
  ["Race Specify", ["Specify Race", "Race"]],
  ["Today's Date", ["Today’s Date", "Date"], "date"],
  ["Signature", ["Employee Signature", "Applicant Signature", "Signed"], "signature"],
];

const checkboxOptionLabels = [
  "Medical",
  "Dental",
  "Vision",
  "Life",
  "Disability",
  "HMO",
  "PPO",
  "POS",
  "HDHP",
  "HSA",
  "FSA",
  "Tobacco",
  "Marital Status",
  "Male",
  "Female",
  "Single",
  "Married",
];

const labelPatterns = targetFieldLabels.map(([label, aliases = [], kind = "text", options = []]) => ({
  label,
  name: `Generated_${fieldNameFromLabel(label)}`,
  pattern: looseLabelPattern([label, ...aliases]),
  kind,
  options,
}));

export async function generateFillableFields(sourceBytes) {
  const pdfBytes = cloneBytesForPdfLib(sourceBytes);
  assertPdfHeader(pdfBytes);

  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const form = pdfDoc.getForm();
  const existingFields = form.getFields();
  if (existingFields.length > 0) {
    return {
      generatedBytes: new Uint8Array(pdfBytes.slice(0)),
      generatedFields: existingFields.map((field) => ({
        kind: existingFieldKind(field),
        label: field.getName(),
        name: field.getName(),
        mode: "acroform",
        pageNumber: null,
      })),
      mode: "acroform",
    };
  }

  const targetPage = pdfDoc.getPage(0);
  const { width: pageWidth, height: pageHeight } = targetPage.getSize();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const generatedFieldSpecs = await detectFieldSpecs(pdfBytes, pageWidth, pageHeight);

  generatedFieldSpecs.forEach((fieldSpec) => {
    try {
      addFieldToPage({ fieldSpec, font, form, page: targetPage, pageHeight });
    } catch (error) {
      console.warn(`Skipping generated field "${fieldSpec.label}".`, error);
    }
  });

  form.updateFieldAppearances(font);
  const generatedBytes = await pdfDoc.save();

  return {
    generatedBytes: new Uint8Array(generatedBytes),
    generatedFields: generatedFieldSpecs.map((fieldSpec) => ({
      ...fieldSpec,
      mode: "generated",
      pageNumber: 1,
      y: fieldSpec.y,
    })),
    mode: "generated",
  };
}

async function detectFieldSpecs(pdfBytes, pageWidth, pageHeight) {
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBytes.slice(0)) });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent();
  const textItems = textContent.items
    .map((item) => toTextBox(item, viewport))
    .filter((item) => item.text.length > 0);
  const lines = groupTextLines(textItems);
  const lineSpecs = [
    ...detectFieldsFromTextLines(lines, viewport),
    ...detectCheckboxFieldsFromTextLines(lines, viewport),
    ...detectCheckboxGlyphFields(textItems, viewport),
  ];
  const uniqueSpecs = dedupeSpecs(lineSpecs);

  await loadingTask.destroy();

  return uniqueSpecs;
}

function toTextBox(item, viewport) {
  const matrix = pdfjsLib.Util.transform(viewport.transform, item.transform);
  const fontHeight = Math.hypot(matrix[2], matrix[3]) || item.height || 0;
  const width = item.width || fontHeight;
  const x = matrix[4];
  const yTop = matrix[5] - fontHeight;

  return {
    text: item.str.trim(),
    x,
    yTop,
    right: x + width,
    bottom: yTop + fontHeight,
    height: fontHeight,
  };
}

function groupTextLines(items) {
  const sorted = [...items].sort((a, b) => a.yTop - b.yTop || a.x - b.x);
  const lines = [];

  sorted.forEach((item) => {
    const line = lines.find((candidate) =>
      Math.abs(candidate.yTop - item.yTop) < Math.min(candidate.height ?? item.height, item.height),
    );
    if (line) {
      line.items.push(item);
      line.yTop = Math.min(line.yTop, item.yTop);
      line.bottom = Math.max(line.bottom, item.bottom);
      line.right = Math.max(line.right, item.right);
    } else {
      lines.push({ yTop: item.yTop, bottom: item.bottom, right: item.right, items: [item] });
    }
  });

  return lines.map((line) => {
    const items = line.items.sort((a, b) => a.x - b.x);
    const x = Math.min(...items.map((item) => item.x));
    const right = Math.max(...items.map((item) => item.right));
    const { spans, text } = buildLineTextSpans(items);
    return {
      text,
      spans,
      items,
      x,
      right,
      width: right - x,
      yTop: line.yTop,
      bottom: line.bottom,
      height: line.bottom - line.yTop,
    };
  }).map((line, index, allLines) => ({
    ...line,
    nextYTop: allLines[index + 1]?.yTop ?? null,
  }));
}

function buildLineTextSpans(items) {
  let text = "";
  const spans = [];

  items.forEach((item, index) => {
    if (index > 0) text += " ";
    const start = text.length;
    text += item.text;
    spans.push({
      start,
      end: text.length,
      item,
    });
  });

  return { spans, text };
}

function detectFieldsFromTextLines(lines, viewport) {
  const specs = [];

  lines.forEach((line) => {
    labelPatterns.forEach((cue) => {
      const match = cue.pattern.exec(line.text);
      if (!match) return;
      if (cue.kind === "choiceLabel") return;

      const labelBBox = textRangeBox(line, match.index, match.index + match[0].length);
      const cellBBox = cellBoxForLabel(line, labelBBox, viewport);
      const fieldBBox = blankFieldBox(cellBBox, labelBBox);
      if (!hasUsableArea(fieldBBox)) return;

      specs.push(viewportRectToPdfSpec({
        kind: cue.kind,
        name: cue.name,
        label: cue.label,
        options: cue.options,
      }, {
        x: round(fieldBBox.left),
        yTop: round(fieldBBox.top),
        width: round(fieldBBox.width),
        height: round(fieldBBox.height),
      }, viewport));
    });
  });

  return specs;
}

function detectCheckboxFieldsFromTextLines(lines, viewport) {
  const specs = [];

  lines.forEach((line) => {
    checkboxOptionLabels.forEach((label) => {
      const pattern = looseLabelPattern([label]);
      const match = pattern.exec(line.text);
      if (!match) return;

      const labelBBox = textRangeBox(line, match.index, match.index + match[0].length);
      const previousItem = [...line.items].reverse().find((item) => item.right <= labelBBox.left);
      if (!previousItem || !isCheckboxToken(previousItem.text)) return;
      const checkboxBBox = itemBox(previousItem);
      if (!hasUsableArea(checkboxBBox)) return;

      specs.push(viewportRectToPdfSpec({
        kind: "checkbox",
        name: `Generated_${fieldNameFromLabel(label)}`,
        label,
      }, {
        x: round(checkboxBBox.left),
        yTop: round(checkboxBBox.top),
        width: round(checkboxBBox.width),
        height: round(checkboxBBox.height),
      }, viewport));
    });
  });

  return specs;
}

function detectCheckboxGlyphFields(items, viewport) {
  return items
    .filter((item) => isCheckboxToken(item.text))
    .map((item, index) => {
      const checkboxBBox = itemBox(item);
      return viewportRectToPdfSpec({
        kind: "checkbox",
        name: `Generated_Checkbox_${index + 1}`,
        label: "Checkbox",
      }, {
        x: round(checkboxBBox.left),
        yTop: round(checkboxBBox.top),
        width: round(checkboxBBox.width),
        height: round(checkboxBBox.height),
      }, viewport);
    });
}

function viewportRectToPdfSpec(field, rect, viewport) {
  const [boxLeft, boxBottom, boxRight] = viewport.viewBox;
  const pdfBoxWidth = Math.abs(boxRight - boxLeft);
  const scaleFactor = pdfBoxWidth / viewport.width;

  return {
    ...field,
    x: round(boxLeft + rect.x * scaleFactor),
    y: round(boxBottom + (viewport.height - rect.yTop - rect.height) * scaleFactor),
    width: round(rect.width * scaleFactor),
    height: round(rect.height * scaleFactor),
  };
}

function findNextLabelX(line, afterTextIndex) {
  const matches = labelPatterns
    .map((cue) => cue.pattern.exec(line.text))
    .filter((match) => match && match.index > afterTextIndex)
    .map((match) => xForTextIndex(line, match.index));

  return matches.length ? Math.min(...matches) : null;
}

function xForTextIndex(line, textIndex) {
  const span = line.spans.find((candidate) => textIndex >= candidate.start && textIndex <= candidate.end);
  if (span) {
    const ratio = span.end === span.start ? 0 : (textIndex - span.start) / (span.end - span.start);
    return span.item.x + (span.item.right - span.item.x) * Math.max(0, Math.min(1, ratio));
  }

  const nextSpan = line.spans.find((candidate) => textIndex < candidate.start);
  if (nextSpan) return nextSpan.item.x;

  return line.right;
}

function textRangeBox(line, startIndex, endIndex) {
  const coveredItems = line.spans
    .filter((span) => span.end >= startIndex && span.start <= endIndex)
    .map((span) => span.item);

  if (!coveredItems.length) {
    const left = xForTextIndex(line, startIndex);
    const right = xForTextIndex(line, endIndex);
    return {
      left,
      top: line.yTop,
      right,
      bottom: line.bottom,
      width: right - left,
      height: line.height,
    };
  }

  const left = Math.min(...coveredItems.map((item) => item.x));
  const right = Math.max(...coveredItems.map((item) => item.right));
  const top = Math.min(...coveredItems.map((item) => item.yTop));
  const bottom = Math.max(...coveredItems.map((item) => item.bottom));

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

function cellBoxForLabel(line, labelBBox, viewport) {
  const nextLabelX = findNextLabelX(line, xIndexForApproximateX(line, labelBBox.right));
  const nextItem = line.items.find((item) => item.x >= labelBBox.right && item.text !== "");
  const right = Math.min(nextLabelX ?? viewport.width, nextItem?.x ?? viewport.width);
  const bottom = line.nextYTop ?? line.bottom + line.height;

  return {
    left: labelBBox.left,
    top: line.yTop,
    right,
    bottom,
    width: right - labelBBox.left,
    height: bottom - line.yTop,
  };
}

function blankFieldBox(cellBBox, labelBBox) {
  const top = cellBBox.top + labelBBox.height;
  const bottom = cellBBox.bottom;

  return {
    left: cellBBox.left,
    top,
    right: cellBBox.right,
    bottom,
    width: cellBBox.width,
    height: bottom - top,
  };
}

function itemBox(item) {
  return {
    left: item.x,
    top: item.yTop,
    right: item.right,
    bottom: item.bottom,
    width: item.right - item.x,
    height: item.bottom - item.yTop,
  };
}

function hasUsableArea(box) {
  return box.width > 0 && box.height > 0;
}

function isCheckboxToken(text) {
  return /^(□|☐|☑|☒|\[\s?\])$/.test(text);
}

function xIndexForApproximateX(line, x) {
  const span = line.spans.find((candidate) => x >= candidate.item.x && x <= candidate.item.right);
  if (!span) return line.text.length;

  const spanWidth = span.item.right - span.item.x;
  const ratio = spanWidth > 0 ? (x - span.item.x) / spanWidth : 0;
  return span.start + (span.end - span.start) * Math.max(0, Math.min(1, ratio));
}

function addFieldToPage({ fieldSpec, font, form, page, pageHeight }) {
  const y = fieldSpec.y;
  const options = {
    x: fieldSpec.x,
    y,
    width: fieldSpec.width,
    height: fieldSpec.height,
    borderWidth: 1,
    borderColor: rgb(0.18, 0.38, 0.92),
    backgroundColor: rgb(0.78, 0.84, 0.97),
    textColor: rgb(0.05, 0.12, 0.24),
    font,
  };

  if (fieldSpec.kind === "checkbox") {
    const checkbox = form.createCheckBox(uniqueFieldName(form, fieldSpec.name));
    const side = Math.min(fieldSpec.width, fieldSpec.height);
    checkbox.addToPage(page, {
      x: fieldSpec.x,
      y,
      width: side,
      height: side,
      borderWidth: 1,
      borderColor: rgb(0.18, 0.38, 0.92),
      backgroundColor: rgb(0.78, 0.84, 0.97),
      textColor: rgb(0.05, 0.12, 0.24),
    });
    return;
  }

  if (fieldSpec.kind === "radio") {
    const radioGroup = form.createRadioGroup(uniqueFieldName(form, fieldSpec.name));
    const choices = fieldSpec.options?.length ? fieldSpec.options : ["Yes", "No"];
    const side = Math.min(fieldSpec.width, fieldSpec.height);
    const step = choices.length > 1 ? (fieldSpec.width - side) / (choices.length - 1) : 0;
    choices.forEach((choice, index) => {
      radioGroup.addOptionToPage(choice, page, {
        ...options,
        x: Math.min(fieldSpec.x + index * step, fieldSpec.x + fieldSpec.width - side),
        width: side,
        height: side,
      });
    });
    return;
  }

  const textField = form.createTextField(uniqueFieldName(form, fieldSpec.name));
  textField.setText("");
  textField.addToPage(page, options);
}

function looseLabelPattern(labels) {
  const alternatives = labels.map((label) =>
    escapeRegExp(label)
      .replace(/\s+/g, "\\s+")
      .replace(/#/g, "(?:#|no\\.?|number)")
      .replace(/\\\$/g, "\\$?"),
  );

  return new RegExp(`\\b(?:${alternatives.join("|")})\\b`, "i");
}

function fieldNameFromLabel(label) {
  return label.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dedupeSpecs(specs) {
  const seen = new Set();
  return specs.filter((spec) => {
    const key = `${spec.name}:${spec.x}:${spec.y}:${spec.width}:${spec.height}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function cloneBytesForPdfLib(bytes) {
  if (bytes instanceof ArrayBuffer) {
    return bytes.slice(0);
  }

  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function assertPdfHeader(bytes) {
  const header = new TextDecoder("ascii").decode(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 8)));

  if (!header.startsWith("%PDF-")) {
    throw new Error("Uploaded bytes do not start with a valid %PDF header.");
  }
}

function uniqueFieldName(form, requestedName) {
  const existingNames = new Set(form.getFields().map((field) => field.getName()));
  let nextName = requestedName;
  let suffix = 2;

  while (existingNames.has(nextName)) {
    nextName = `${requestedName}_${suffix}`;
    suffix += 1;
  }

  return nextName;
}

function existingFieldKind(field) {
  const typeName = field.constructor?.name || "";
  if (/CheckBox/i.test(typeName)) return "checkbox";
  if (/Radio/i.test(typeName)) return "radio";
  if (/Signature/i.test(typeName)) return "signature";
  return "text";
}
