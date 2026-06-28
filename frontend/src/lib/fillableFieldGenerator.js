export const FIELD_TYPES = ["text", "date", "checkbox", "signature", "table_cell"];

export function normalizeDetectedField(field, index) {
  const geometry = field?.geometry || {};
  return {
    page_number: Number(field?.page_number) || 1,
    field_id: String(field?.field_id || `field_${index + 1}`),
    type: FIELD_TYPES.includes(field?.type) ? field.type : "text",
    label_context: String(field?.label_context || ""),
    bbox: Array.isArray(field?.bbox) ? field.bbox.map(clampUnit).slice(0, 4) : null,
    column_index: Number.isFinite(Number(field?.column_index)) ? Number(field.column_index) : 0,
    row_index: Number.isFinite(Number(field?.row_index)) ? Number(field.row_index) : 0,
    selection_tokens: Array.isArray(field?.selection_tokens)
      ? field.selection_tokens.map(normalizeSelectionToken).filter(Boolean)
      : [],
    geometry: {
      x: clampUnit(geometry.x),
      y: clampUnit(geometry.y),
      width: clampUnit(geometry.width),
      height: clampUnit(geometry.height),
    },
  };
}

export function formatFieldType(field) {
  if (field.type !== "table_cell") return field.type;
  return "table cell";
}

export function tableCellPlaceholder(field) {
  const label = field.label_context.toLowerCase();
  if (label.includes("birth") || label.includes("date") || label.includes("dob")) return "MM/DD/YYYY";
  if (label.includes("name")) return "Name";
  return "";
}

function normalizeSelectionToken(token) {
  if (!token?.geometry) return null;

  return {
    value: String(token.value || ""),
    geometry: {
      x: clampUnit(token.geometry.x),
      y: clampUnit(token.geometry.y),
      width: clampUnit(token.geometry.width),
      height: clampUnit(token.geometry.height),
    },
  };
}

function clampUnit(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return 0;
  return Math.min(1, Math.max(0, numberValue));
}
