'use strict';
// Field-type registry — the admin's extension point for object-part form fields. Add a custom type by
// adding an entry here (in the site-owned copy). Each type declares:
//   label                      human name (for pickers)
//   input(name, value, field)  -> HTML for the form control (used by the frontend)
//   parse(raw)                 form value -> stored value (e.g. "3" -> 3)
//   serialize(value)           stored value -> form value
//   validate(value, field)     -> error string | null
// A collection's data_model object part carries a `schema` map { fieldName: { type, label, required,
// options, ... } }; the server validates writes against it and the frontend renders a form from it.
//
// Isomorphic: `require('./fieldTypes')` in Node (the server) and `<script src="fieldTypes.js">` in the
// browser (sets window.FieldTypes) both yield the same registry.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FieldTypes = api;
})(typeof self !== 'undefined' ? self : this, function () {
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  const isBlank = v => v == null || v === '';
  const optionList = f => ((f && f.options) || []).map(o => (o && typeof o === 'object')
    ? { value: o.value, label: o.label != null ? o.label : o.value }
    : { value: o, label: o });

  const types = {
    string: {
      label: 'Text',
      input: (n, v, f) => `<input type="text" name="${esc(n)}" value="${esc(v)}"${f && f.required ? ' required' : ''}>`,
      parse: r => r == null ? '' : String(r),
      serialize: v => v == null ? '' : String(v),
      validate: (v, f) => (f && f.required && isBlank(v)) ? 'is required' : null
    },
    text: {
      label: 'Multiline text',
      input: (n, v, f) => `<textarea name="${esc(n)}" rows="4"${f && f.required ? ' required' : ''}>${esc(v)}</textarea>`,
      parse: r => r == null ? '' : String(r),
      serialize: v => v == null ? '' : String(v),
      validate: (v, f) => (f && f.required && isBlank(v)) ? 'is required' : null
    },
    number: {
      label: 'Number',
      input: (n, v, f) => `<input type="number" name="${esc(n)}" value="${esc(v)}"${f && f.required ? ' required' : ''}>`,
      parse: r => isBlank(r) ? null : Number(r),
      serialize: v => v == null ? '' : String(v),
      validate: (v, f) => {
        if (isBlank(v)) return (f && f.required) ? 'is required' : null;
        return Number.isNaN(Number(v)) ? 'must be a number' : null;
      }
    },
    boolean: {
      label: 'Yes / no',
      input: (n, v) => `<input type="checkbox" name="${esc(n)}"${v ? ' checked' : ''}>`,
      parse: r => r === true || r === 'true' || r === 'on' || r === 1,
      serialize: v => !!v,
      validate: () => null
    },
    select: {
      label: 'Choice',
      input: (n, v, f) => {
        const opts = optionList(f)
          .map(o => `<option value="${esc(o.value)}"${String(o.value) === String(v) ? ' selected' : ''}>${esc(o.label)}</option>`)
          .join('');
        return `<select name="${esc(n)}"${f && f.required ? ' required' : ''}>${opts}</select>`;
      },
      parse: r => r == null ? '' : String(r),
      serialize: v => v == null ? '' : String(v),
      validate: (v, f) => {
        if (isBlank(v)) return (f && f.required) ? 'is required' : null;
        return optionList(f).some(o => String(o.value) === String(v)) ? null : 'is not one of the allowed choices';
      }
    },
    datetime: {
      label: 'Date / time',
      input: (n, v, f) => `<input type="datetime-local" name="${esc(n)}" value="${esc(v)}"${f && f.required ? ' required' : ''}>`,
      parse: r => isBlank(r) ? '' : String(r),
      serialize: v => v == null ? '' : String(v),
      validate: (v, f) => {
        if (isBlank(v)) return (f && f.required) ? 'is required' : null;
        return Number.isNaN(Date.parse(v)) ? 'is not a valid date/time' : null;
      }
    }
  };

  // A field's type object, defaulting unknown/blank types to `string`.
  function typeOf(field) { return types[(field && field.type)] || types.string; }

  // Validate an object against a schema map. Returns an array of human messages ([] when valid).
  function validateObject(obj, schema) {
    const errors = [];
    obj = obj || {};
    for (const [name, field] of Object.entries(schema || {})) {
      const err = typeOf(field).validate(obj[name], field);
      if (err) errors.push(`"${(field && field.label) || name}" ${err}`);
    }
    return errors;
  }

  return { types, typeOf, validateObject, esc };
});
