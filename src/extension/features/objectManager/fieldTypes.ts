// Catalog of every field type the Salesforce "New Field" wizard offers, with
// the type-specific settings each one exposes and a builder that turns the
// collected values into a Tooling-API CustomField Metadata payload.
//
// Metadata reference: CustomField in the Metadata API developer guide. The
// Tooling CustomField sObject accepts the same Metadata shape via
// { FullName: 'Obj__c.Field__c', Metadata: {...} }.

export interface PicklistValueInput { label: string; default?: boolean }

/** Everything the wizard can collect. Only the keys relevant to the chosen type are read. */
export interface FieldFormValues {
  label: string;
  apiName: string; // without __c
  description?: string;
  helpText?: string;
  required?: boolean;
  unique?: boolean;
  caseSensitive?: boolean;
  externalId?: boolean;
  defaultValue?: string;
  length?: number;
  precision?: number;
  scale?: number;
  visibleLines?: number;
  // Picklist
  picklistValues?: PicklistValueInput[];
  sorted?: boolean;
  restricted?: boolean;
  // Relationship
  referenceTo?: string;
  relationshipLabel?: string;
  relationshipName?: string;
  deleteConstraint?: 'SetNull' | 'Restrict';
  writeRequiresMasterRead?: boolean;
  reparentableMasterDetail?: boolean;
  // AutoNumber
  displayFormat?: string;
  startingNumber?: number;
  // Formula
  formula?: string;
  formulaReturnType?: string;
  formulaTreatBlanksAs?: 'BlankAsZero' | 'BlankAsBlank';
  // Geolocation
  displayLocationInDecimal?: boolean;
}

export type SettingKey =
  | 'required' | 'unique' | 'externalId' | 'defaultValue' | 'length' | 'precisionScale'
  | 'visibleLines' | 'picklist' | 'lookup' | 'masterDetail' | 'autoNumber' | 'formula' | 'geolocation'
  | 'checkboxDefault';

export interface FieldTypeDef {
  /** Metadata API type value (Formula is virtual — resolved to its return type). */
  type: string;
  label: string;
  icon: string;
  desc: string;
  settings: SettingKey[];
  defaults?: Partial<FieldFormValues>;
}

export const FIELD_TYPES: FieldTypeDef[] = [
  { type: 'AutoNumber', label: 'Auto Number', icon: '🔢', desc: 'System-generated sequence number', settings: ['autoNumber', 'externalId'] },
  { type: 'Formula', label: 'Formula', icon: '🧮', desc: 'Read-only value derived from other fields', settings: ['formula'] },
  { type: 'Lookup', label: 'Lookup Relationship', icon: '🔗', desc: 'Links this object to another object', settings: ['lookup', 'required'] },
  { type: 'MasterDetail', label: 'Master-Detail Relationship', icon: '⛓️', desc: 'Parent-child relationship with rollups', settings: ['masterDetail'] },
  { type: 'Checkbox', label: 'Checkbox', icon: '☑️', desc: 'True or false value', settings: ['checkboxDefault'] },
  { type: 'Currency', label: 'Currency', icon: '💰', desc: 'Money amount in the org currency', settings: ['precisionScale', 'required', 'defaultValue'], defaults: { precision: 16, scale: 2 } },
  { type: 'Date', label: 'Date', icon: '📅', desc: 'Calendar date picker', settings: ['required', 'defaultValue'] },
  { type: 'DateTime', label: 'Date/Time', icon: '🕐', desc: 'Date and time picker', settings: ['required', 'defaultValue'] },
  { type: 'Email', label: 'Email', icon: '✉️', desc: 'Validated email address', settings: ['required', 'unique', 'externalId', 'defaultValue'] },
  { type: 'Location', label: 'Geolocation', icon: '📍', desc: 'Latitude and longitude', settings: ['geolocation'], defaults: { scale: 5 } },
  { type: 'Number', label: 'Number', icon: '#️⃣', desc: 'Numeric value with decimals', settings: ['precisionScale', 'required', 'unique', 'externalId', 'defaultValue'], defaults: { precision: 18, scale: 0 } },
  { type: 'Percent', label: 'Percent', icon: '％', desc: 'Number with a percent sign', settings: ['precisionScale', 'required', 'defaultValue'], defaults: { precision: 16, scale: 2 } },
  { type: 'Phone', label: 'Phone', icon: '📞', desc: 'Formatted phone number', settings: ['required', 'defaultValue'] },
  { type: 'Picklist', label: 'Picklist', icon: '📋', desc: 'Select one value from a list', settings: ['picklist', 'required'] },
  { type: 'MultiselectPicklist', label: 'Picklist (Multi-Select)', icon: '📚', desc: 'Select multiple values from a list', settings: ['picklist', 'visibleLines', 'required'], defaults: { visibleLines: 4 } },
  { type: 'Text', label: 'Text', icon: '🔤', desc: 'Up to 255 characters', settings: ['length', 'required', 'unique', 'externalId', 'defaultValue'], defaults: { length: 255 } },
  { type: 'TextArea', label: 'Text Area', icon: '📝', desc: 'Up to 255 characters, multiple lines', settings: ['required'] },
  { type: 'LongTextArea', label: 'Text Area (Long)', icon: '📄', desc: 'Up to 131,072 characters', settings: ['length', 'visibleLines'], defaults: { length: 32768, visibleLines: 3 } },
  { type: 'Html', label: 'Text Area (Rich)', icon: '🎨', desc: 'Formatted text with images and links', settings: ['length', 'visibleLines'], defaults: { length: 32768, visibleLines: 10 } },
  { type: 'Time', label: 'Time', icon: '⏰', desc: 'Time of day without a date', settings: ['required'] },
  { type: 'Url', label: 'URL', icon: '🌐', desc: 'Clickable hyperlink', settings: ['required', 'defaultValue'] },
];

export const FORMULA_RETURN_TYPES = [
  { value: 'Checkbox', label: 'Checkbox' },
  { value: 'Currency', label: 'Currency' },
  { value: 'Date', label: 'Date' },
  { value: 'DateTime', label: 'Date/Time' },
  { value: 'Number', label: 'Number' },
  { value: 'Percent', label: 'Percent' },
  { value: 'Text', label: 'Text' },
  { value: 'Time', label: 'Time' },
];

/** Validate per-type requirements before building metadata. Returns error or null. */
export function validateFieldValues(def: FieldTypeDef, v: FieldFormValues): string | null {
  if (!v.label.trim()) return 'Field label is required.';
  if (def.settings.includes('length')) {
    const max = def.type === 'Text' ? 255 : 131072;
    if (!v.length || v.length < 1 || v.length > max) return `Length must be between 1 and ${max.toLocaleString()}.`;
  }
  if (def.settings.includes('precisionScale')) {
    const p = v.precision ?? 0, s = v.scale ?? 0;
    if (p < 1 || s < 0 || p + s > 18) return 'Digits + decimal places cannot exceed 18.';
  }
  if (def.settings.includes('picklist') && (!v.picklistValues || v.picklistValues.length === 0)) return 'Enter at least one picklist value.';
  if (def.settings.includes('autoNumber')) {
    if (!v.displayFormat || !/\{0+\}/.test(v.displayFormat)) return 'Display format must include a {0} placeholder, e.g. A-{0000}.';
  }
  if (def.type === 'Lookup' || def.type === 'MasterDetail') {
    if (!v.referenceTo) return 'Choose the object to relate to.';
    if (!v.relationshipName) return 'Child relationship name is required.';
  }
  if (def.type === 'Formula' && !v.formula?.trim()) return 'Enter a formula.';
  return null;
}

/** Build the Tooling CustomField Metadata payload for a validated form. */
export function buildFieldMetadata(def: FieldTypeDef, v: FieldFormValues): Record<string, unknown> {
  const m: Record<string, unknown> = {
    label: v.label.trim(),
    description: v.description?.trim() || undefined,
    inlineHelpText: v.helpText?.trim() || undefined,
  };

  const s = new Set(def.settings);
  if (s.has('required')) m.required = v.required === true;
  if (s.has('unique') && v.unique) { m.unique = true; if (def.type === 'Text') m.caseSensitive = v.caseSensitive === true; }
  if (s.has('externalId')) m.externalId = v.externalId === true;
  if (s.has('defaultValue') && v.defaultValue?.trim()) m.defaultValue = wrapDefault(def.type, v.defaultValue.trim());
  if (s.has('length')) m.length = v.length;
  if (s.has('precisionScale')) { m.precision = v.precision; m.scale = v.scale; }
  if (s.has('visibleLines')) m.visibleLines = v.visibleLines;

  switch (def.type) {
    case 'Checkbox':
      m.defaultValue = v.defaultValue === 'true' ? 'true' : 'false';
      m.type = 'Checkbox';
      break;
    case 'AutoNumber':
      m.type = 'AutoNumber';
      m.displayFormat = v.displayFormat;
      m.startingNumber = v.startingNumber ?? 1;
      break;
    case 'Formula': {
      // A formula field's Metadata type IS its return type; the formula
      // attributes ride along.
      const rt = v.formulaReturnType || 'Text';
      m.type = rt;
      m.formula = v.formula;
      if (rt === 'Number' || rt === 'Currency' || rt === 'Percent') {
        m.precision = v.precision ?? 18;
        m.scale = v.scale ?? 2;
        m.formulaTreatBlanksAs = v.formulaTreatBlanksAs || 'BlankAsZero';
      }
      break;
    }
    case 'Lookup':
      m.type = 'Lookup';
      m.referenceTo = v.referenceTo;
      m.relationshipLabel = v.relationshipLabel || undefined;
      m.relationshipName = v.relationshipName;
      m.deleteConstraint = v.deleteConstraint || 'SetNull';
      break;
    case 'MasterDetail':
      m.type = 'MasterDetail';
      m.referenceTo = v.referenceTo;
      m.relationshipLabel = v.relationshipLabel || undefined;
      m.relationshipName = v.relationshipName;
      m.writeRequiresMasterRead = v.writeRequiresMasterRead === true;
      m.reparentableMasterDetail = v.reparentableMasterDetail === true;
      delete m.required; // implied by master-detail
      break;
    case 'Location':
      m.type = 'Location';
      m.scale = v.scale ?? 5;
      m.displayLocationInDecimal = v.displayLocationInDecimal !== false;
      break;
    case 'Picklist':
    case 'MultiselectPicklist':
      m.type = def.type;
      m.valueSet = {
        restricted: v.restricted === true,
        valueSetDefinition: {
          sorted: v.sorted === true,
          value: (v.picklistValues || []).map((p) => ({ fullName: p.label, label: p.label, default: p.default === true })),
        },
      };
      break;
    default:
      m.type = def.type;
  }

  // Strip undefined keys — the Tooling API rejects nulls for some attributes.
  Object.keys(m).forEach((k) => { if (m[k] === undefined) delete m[k]; });
  return m;
}

/** Text-ish defaults must be quoted formula literals; numbers/dates pass through. */
function wrapDefault(type: string, raw: string): string {
  const needsQuotes = ['Text', 'Email', 'Phone', 'Url', 'Picklist'].includes(type);
  if (!needsQuotes) return raw;
  if (/^".*"$/.test(raw) || /^[A-Z]+\(/i.test(raw)) return raw; // already a formula
  return `"${raw.replace(/"/g, '\\"')}"`;
}
