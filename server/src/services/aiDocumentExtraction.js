import fs from 'node:fs';
import path from 'node:path';
import mammoth from 'mammoth';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { db, serializeField } from '../db/db.js';
import { clientUploadsDir, config, resolveInside } from '../config.js';
import { generateFilledPdf } from './pdfFill.js';
import { getTemplateFields } from './templateAccess.js';

const nullableText = z.string().nullable();
const confidence = z.number().min(0).max(1);
const localTextLimit = 14000;
const openAiResponsesUrl = 'https://api.openai.com/v1/responses';

const extractedDocumentSchema = z.object({
  document_kind: z.string(),
  summary: z.string(),
  extracted_text: z.string(),
  parties: z.array(z.object({
    role: z.string(),
    full_name: nullableText,
    first_name: nullableText,
    surname: nullableText,
    id_number: nullableText,
    passport_number: nullableText,
    date_of_birth: nullableText,
    phone: nullableText,
    email: nullableText,
    address: nullableText,
    legal_presence_details: nullableText
  })),
  accident: z.object({
    date: nullableText,
    time: nullableText,
    location: nullableText,
    police_station: nullableText,
    police_case_number: nullableText,
    accident_report_number: nullableText,
    claimant_role: nullableText,
    description: nullableText,
    vehicles: z.array(z.object({
      registration: nullableText,
      make: nullableText,
      model: nullableText,
      description: nullableText,
      driver_name: nullableText,
      owner_name: nullableText
    })),
    witnesses: z.array(z.object({
      name: nullableText,
      contact: nullableText,
      statement: nullableText
    }))
  }),
  medical: z.object({
    injuries: z.array(z.string()),
    diagnoses: z.array(z.string()),
    treatment: z.array(z.string()),
    providers: z.array(z.object({ name: nullableText, type: nullableText, contact: nullableText })),
    admission_date: nullableText,
    discharge_date: nullableText,
    sick_leave: nullableText,
    tests_and_scans: z.array(z.string())
  }),
  employment: z.object({
    employer: nullableText,
    occupation: nullableText,
    income_before_accident: nullableText,
    income_after_accident: nullableText,
    sick_or_unpaid_leave: nullableText,
    work_capacity_notes: nullableText
  }),
  banking: z.object({
    bank_name: nullableText,
    account_holder: nullableText,
    account_number: nullableText,
    branch_code: nullableText,
    branch_name: nullableText,
    account_type: nullableText
  }),
  expenses: z.array(z.object({
    category: z.string(),
    provider: nullableText,
    service_date: nullableText,
    invoice_number: nullableText,
    amount: nullableText,
    payment_status: nullableText
  })),
  facts: z.array(z.object({
    key: z.string(),
    value: z.string(),
    source: z.string(),
    confidence
  })),
  template_values: z.array(z.object({
    field_name: z.string(),
    value: z.string(),
    source: z.string(),
    confidence
  })),
  warnings: z.array(z.string()),
  overall_confidence: confidence
});

const templateFieldReviewSchema = z.object({
  decisions: z.array(z.object({
    field_name: z.string(),
    status: z.enum(['fillable', 'no_evidence', 'conflict']),
    value: nullableText,
    source: nullableText,
    reason: z.string(),
    confidence
  }))
});

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function hasValue(value) {
  if (Array.isArray(value)) return value.some(hasValue);
  return value != null && String(value).trim() !== '';
}

function normalizeKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value || {}).filter(([, entry]) => hasValue(entry)));
}

function normalizePersonText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function personMatchesClaim(party, claim) {
  const extractedFirst = normalizePersonText(party?.first_name);
  const extractedSurname = normalizePersonText(party?.surname);
  const extractedFullName = normalizePersonText(party?.full_name);
  const claimFirst = normalizePersonText(claim?.first_name);
  const claimSurname = normalizePersonText(claim?.surname);

  if (!extractedFirst && !extractedSurname && !extractedFullName) return true;
  if (extractedSurname && claimSurname && extractedSurname !== claimSurname) return false;
  if (extractedFirst && claimFirst && extractedFirst !== claimFirst) return false;
  if (!extractedFirst && claimFirst && extractedFullName && !extractedFullName.includes(claimFirst)) return false;
  if (!extractedSurname && claimSurname && extractedFullName && !extractedFullName.includes(claimSurname)) return false;
  return true;
}

function mergeMissing(current, extracted) {
  const merged = { ...(current || {}) };
  for (const [key, value] of Object.entries(extracted || {})) {
    if (!hasValue(merged[key]) && hasValue(value)) merged[key] = value;
  }
  return merged;
}

function buildTemplateFieldPrompt(firmDb, caseId) {
  const attachments = firmDb.prepare('SELECT template_id FROM claim_form_templates WHERE case_id = ?').all(caseId);
  return attachments.flatMap(({ template_id: templateId }) => {
    const template = db.prepare('SELECT id, name FROM document_templates WHERE id = ?').get(templateId);
    if (!template) return [];
    return getTemplateFields(template.id).map((field) => ({
      template: template.name,
      field_name: field.name,
      label: field.label,
      field_type: field.field_type
    }));
  });
}

async function extractPdfText(fileBuffer) {
  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(fileBuffer), useSystemFonts: true });
    const pdf = await loadingTask.promise;
    const pages = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => String(item.str || '').trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) pages.push(`Page ${pageNumber}: ${text}`);
      if (pages.join('\n\n').length >= localTextLimit) break;
    }

    return pages.join('\n\n').slice(0, localTextLimit);
  } catch (error) {
    console.warn('Local PDF text extraction skipped:', error.message);
    return '';
  }
}

async function extractLocalDocumentText(upload, fileBuffer) {
  const extension = path.extname(upload.original_filename || '').toLowerCase();
  const mediaType = upload.mime_type || '';

  if (mediaType === 'application/pdf' || extension === '.pdf') {
    return extractPdfText(fileBuffer);
  }

  if (extension === '.docx' || mediaType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const { value } = await mammoth.extractRawText({ buffer: fileBuffer });
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, localTextLimit);
  }

  if (mediaType.startsWith('text/') || extension === '.txt') {
    return fileBuffer.toString('utf8').replace(/\s+/g, ' ').trim().slice(0, localTextLimit);
  }

  return '';
}

async function buildDocumentContent(upload, fileBuffer) {
  const extension = path.extname(upload.original_filename || '').toLowerCase();
  const mediaType = upload.mime_type || '';
  const localText = await extractLocalDocumentText(upload, fileBuffer);
  const localTextPart = localText
    ? [{
        type: 'text',
        text: `Local OCR/text extraction from ${upload.original_filename}:\n\n${localText}`
      }]
    : [];

  if (mediaType.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) {
    return [
      ...localTextPart,
      {
        type: 'file',
        data: fileBuffer,
        mediaType: mediaType || `image/${extension.slice(1)}`,
        filename: upload.original_filename
      }
    ];
  }

  if (mediaType === 'application/pdf' || extension === '.pdf') {
    return [
      ...localTextPart,
      {
        type: 'file',
        data: fileBuffer,
        mediaType: 'application/pdf',
        filename: upload.original_filename
      }
    ];
  }

  if (extension === '.docx' || mediaType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return localTextPart.length ? localTextPart : [{ type: 'text', text: 'No readable Word document text was extracted.' }];
  }

  if (mediaType.startsWith('text/') || extension === '.txt') {
    return localTextPart.length ? localTextPart : [{ type: 'text', text: 'No readable text was extracted.' }];
  }

  throw new Error('AI extraction currently supports PDF, image, DOCX, and text files. Convert legacy .doc files to PDF or DOCX.');
}

async function buildResponsesDocumentContent(upload, fileBuffer) {
  const extension = path.extname(upload.original_filename || '').toLowerCase();
  const mediaType = upload.mime_type || '';
  const localText = await extractLocalDocumentText(upload, fileBuffer);
  const content = [];

  if (localText) {
    content.push({
      type: 'input_text',
      text: `Local OCR/text extraction from ${upload.original_filename}:\n\n${localText}`
    });
  }

  if (mediaType === 'application/pdf' || extension === '.pdf') {
    content.push({
      type: 'input_file',
      filename: upload.original_filename || 'uploaded-document.pdf',
      file_data: `data:application/pdf;base64,${fileBuffer.toString('base64')}`
    });
    return content;
  }

  if (mediaType.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) {
    const imageType = mediaType || `image/${extension.slice(1)}`;
    content.push({
      type: 'input_image',
      detail: 'high',
      image_url: `data:${imageType};base64,${fileBuffer.toString('base64')}`
    });
    return content;
  }

  if (extension === '.docx' || mediaType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return content.length ? content : [{ type: 'input_text', text: 'No readable Word document text was extracted.' }];
  }

  if (mediaType.startsWith('text/') || extension === '.txt') {
    return content.length ? content : [{ type: 'input_text', text: 'No readable text was extracted.' }];
  }

  throw new Error('AI extraction currently supports PDF, image, DOCX, and text files. Convert legacy .doc files to PDF or DOCX.');
}

function extractResponseText(responseBody) {
  if (typeof responseBody?.output_text === 'string') return responseBody.output_text;
  const output = Array.isArray(responseBody?.output) ? responseBody.output : [];
  return output
    .flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .map((content) => content.text || '')
    .filter(Boolean)
    .join('\n')
    .trim();
}

async function generateDocumentExtractionWithOpenAi({ request, claim, templateFields, upload, fileBuffer }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);

  try {
    const response = await fetch(openAiResponsesUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.openAiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.aiExtractionModel,
        store: false,
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: extractionInstructions({ request, claim, templateFields }) },
            ...await buildResponsesDocumentContent(upload, fileBuffer)
          ]
        }],
        text: {
          format: {
            type: 'json_schema',
            name: 'raf_document_extraction',
            description: 'Verified structured facts extracted from one RAF claim document',
            schema: z.toJSONSchema(extractedDocumentSchema),
            strict: false
          }
        }
      }),
      signal: controller.signal
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body?.error?.message || `OpenAI API request failed with HTTP ${response.status}`);
    }
    if (body?.status === 'failed') {
      throw new Error(body?.error?.message || 'OpenAI response failed');
    }

    const text = extractResponseText(body);
    const parsed = JSON.parse(text);
    return extractedDocumentSchema.parse(parsed);
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('OpenAI extraction timed out after 180 seconds');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function extractionInstructions({ request, claim, templateFields }) {
  return `You extract structured data from South African Road Accident Fund claim documents.

Document upload category: ${request.label}
Claim reference: ${claim.case_reference}
Known client: ${claim.first_name} ${claim.surname}
Existing case summary (may be empty): ${claim.ai_summary || ''}

Requirements:
- Read typed and handwritten content carefully. Use the uploaded file as the source of truth.
- Use the local OCR/text extraction when it is available, but verify it against the attached file because OCR can split words or miss handwriting.
- For scanned PDFs and images, perform visual OCR from the attached file and extract visible text even when local OCR/text extraction is empty.
- Never invent a value. Use null for missing scalar values and [] for missing lists.
- Dates must be YYYY-MM-DD when the full date is known; otherwise preserve the visible text in facts.
- Keep ID, passport, case, report, account and invoice numbers exactly as printed.
- extracted_text must be a compact transcription of the important text, capped at about 12,000 characters.
- summary must be a concise factual summary suitable for reuse by a later AI request.
- Put every useful item that does not fit a named field into facts.
- Populate template_values only when the document clearly supports the value. Use the exact field_name supplied below.
- Confidence is 0 to 1. Add warnings for illegible, conflicting, incomplete or uncertain information.

Attached template fields:
${JSON.stringify(templateFields.slice(0, 250))}`;
}

function updateRelevantClaimFields(firmDb, claim, extraction) {
  const claimant = extraction.parties.find((party) => /claimant|client|patient|injured/i.test(party.role)) || extraction.parties[0] || {};
  const claimantMatches = personMatchesClaim(claimant, claim);
  const bank = mergeMissing(parseJson(claim.banking_json), extraction.banking);
  const firstVehicle = extraction.accident.vehicles[0] || {};
  const firstDriver = compactObject({ name: firstVehicle.driver_name });
  const witnesses = extraction.accident.witnesses.map(compactObject).filter((item) => Object.keys(item).length);

  firmDb.prepare(`
    UPDATE firm_clients
    SET
      id_number = CASE WHEN ? AND COALESCE(TRIM(id_number), '') = '' THEN ? ELSE id_number END,
      passport_number = CASE WHEN COALESCE(TRIM(passport_number), '') = '' THEN ? ELSE passport_number END,
      date_of_birth = CASE WHEN COALESCE(TRIM(date_of_birth), '') = '' THEN ? ELSE date_of_birth END,
      residential_address = CASE WHEN COALESCE(TRIM(residential_address), '') = '' THEN ? ELSE residential_address END,
      occupation = CASE WHEN COALESCE(TRIM(occupation), '') = '' THEN ? ELSE occupation END,
      employer_details = CASE WHEN COALESCE(TRIM(employer_details), '') = '' THEN ? ELSE employer_details END,
      banking_json = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    claimantMatches ? 1 : 0,
    claimant.id_number,
    claimantMatches ? claimant.passport_number : null,
    claimantMatches ? claimant.date_of_birth : null,
    claimantMatches ? claimant.address : null,
    claimantMatches ? extraction.employment.occupation : null,
    claimantMatches ? extraction.employment.employer : null,
    claimantMatches && Object.keys(compactObject(bank)).length ? JSON.stringify(compactObject(bank)) : claim.banking_json,
    claim.client_id
  );

  firmDb.prepare(`
    UPDATE raf_cases
    SET
      accident_date = CASE WHEN COALESCE(TRIM(accident_date), '') = '' THEN ? ELSE accident_date END,
      accident_time = CASE WHEN COALESCE(TRIM(accident_time), '') = '' THEN ? ELSE accident_time END,
      accident_location = CASE WHEN COALESCE(TRIM(accident_location), '') = '' THEN ? ELSE accident_location END,
      police_station = CASE WHEN COALESCE(TRIM(police_station), '') = '' THEN ? ELSE police_station END,
      police_case_number = CASE WHEN COALESCE(TRIM(police_case_number), '') = '' THEN ? ELSE police_case_number END,
      claimant_role = CASE WHEN COALESCE(TRIM(claimant_role), '') = '' THEN ? ELSE claimant_role END,
      collision_description = CASE WHEN COALESCE(TRIM(collision_description), '') = '' THEN ? ELSE collision_description END,
      vehicle_json = CASE WHEN COALESCE(TRIM(vehicle_json), '') = '' THEN ? ELSE vehicle_json END,
      driver_json = CASE WHEN COALESCE(TRIM(driver_json), '') = '' THEN ? ELSE driver_json END,
      witnesses_json = CASE WHEN COALESCE(TRIM(witnesses_json), '') = '' THEN ? ELSE witnesses_json END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    extraction.accident.date,
    extraction.accident.time,
    extraction.accident.location,
    extraction.accident.police_station,
    extraction.accident.police_case_number,
    extraction.accident.claimant_role,
    extraction.accident.description,
    Object.keys(compactObject(firstVehicle)).length ? JSON.stringify(compactObject(firstVehicle)) : null,
    Object.keys(firstDriver).length ? JSON.stringify(firstDriver) : null,
    witnesses.length ? JSON.stringify(witnesses) : null,
    claim.id
  );
}

function buildExtractedValueMap(extraction) {
  const claimant = extraction.parties.find((party) => /claimant|client|patient|injured/i.test(party.role)) || extraction.parties[0] || {};
  const values = {
    first_name: claimant.first_name,
    surname: claimant.surname,
    full_name: claimant.full_name,
    claimant_name: claimant.full_name,
    id_number: claimant.id_number,
    passport_number: claimant.passport_number,
    date_of_birth: claimant.date_of_birth,
    residential_address: claimant.address,
    address: claimant.address,
    accident_date: extraction.accident.date,
    date_of_accident: extraction.accident.date,
    accident_time: extraction.accident.time,
    accident_location: extraction.accident.location,
    police_station: extraction.accident.police_station,
    police_case_number: extraction.accident.police_case_number,
    accident_report_number: extraction.accident.accident_report_number,
    claimant_role: extraction.accident.claimant_role,
    collision_description: extraction.accident.description,
    accident_description: extraction.accident.description,
    injuries: extraction.medical.injuries.join(', '),
    diagnosis: extraction.medical.diagnoses.join(', '),
    treatment: extraction.medical.treatment.join(', '),
    occupation: extraction.employment.occupation,
    employer: extraction.employment.employer,
    bank_name: extraction.banking.bank_name,
    account_holder: extraction.banking.account_holder,
    account_number: extraction.banking.account_number,
    branch_code: extraction.banking.branch_code,
    branch_name: extraction.banking.branch_name,
    account_type: extraction.banking.account_type
  };

  const mapped = new Map();
  for (const [key, value] of Object.entries(values)) {
    if (hasValue(value)) mapped.set(normalizeKey(key), value);
  }
  for (const item of extraction.template_values) {
    if (hasValue(item.value)) mapped.set(normalizeKey(item.field_name), item.value);
  }
  for (const item of extraction.facts) {
    if (hasValue(item.value) && !mapped.has(normalizeKey(item.key))) mapped.set(normalizeKey(item.key), item.value);
  }
  return mapped;
}

async function autofillAttachedTemplates(firmDb, caseId, extraction) {
  const attachments = firmDb.prepare('SELECT * FROM claim_form_templates WHERE case_id = ?').all(caseId);
  const extractedValues = buildExtractedValueMap(extraction);
  let filledCount = 0;

  for (const attachment of attachments) {
    const template = db.prepare('SELECT * FROM document_templates WHERE id = ? AND status = ?').get(attachment.template_id, 'ready');
    if (!template) continue;
    const fields = getTemplateFields(template.id).map(serializeField);
    if (!fields.length) continue;
    const existingDocument = attachment.generated_document_id
      ? db.prepare('SELECT * FROM generated_documents WHERE id = ?').get(attachment.generated_document_id)
      : null;
    const data = parseJson(existingDocument?.input_json, {});
    let changed = false;

    for (const field of fields) {
      if (hasValue(data[field.name])) continue;
      const extractedValue = extractedValues.get(normalizeKey(field.name)) || extractedValues.get(normalizeKey(field.label));
      if (!hasValue(extractedValue)) continue;
      data[field.name] = extractedValue;
      changed = true;
    }

    if (!changed) continue;
    const document = await generateFilledPdf({
      template,
      fields,
      data,
      userId: existingDocument?.user_id || template.user_id,
      sourceType: 'ai_document_extraction'
    });
    firmDb.prepare(`
      UPDATE claim_form_templates
      SET generated_document_id = ?, status = 'generated', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(document.id, attachment.id);
    filledCount += 1;
  }

  return filledCount;
}

function buildClaimRecordContext(claim, firm) {
  return {
    firm: compactObject({
      name: firm?.name,
      contact_name: firm?.contact_name,
      contact_email: firm?.contact_email,
      contact_phone: firm?.contact_phone,
      address: firm?.address
    }),
    client: compactObject({
      first_name: claim.first_name,
      surname: claim.surname,
      id_number: claim.id_number,
      passport_number: claim.passport_number,
      date_of_birth: claim.date_of_birth,
      cell: claim.cell,
      email: claim.email,
      residential_address: claim.residential_address,
      occupation: claim.occupation,
      employer_details: claim.employer_details
    }),
    claim: compactObject({
      case_reference: claim.case_reference,
      claim_type: claim.claim_type,
      status: claim.status,
      accident_date: claim.accident_date,
      accident_time: claim.accident_time,
      accident_location: claim.accident_location,
      police_station: claim.police_station,
      police_case_number: claim.police_case_number,
      claimant_role: claim.claimant_role,
      collision_description: claim.collision_description,
      statutory_form_set: claim.statutory_form_set,
      lodgement_deadline: claim.lodgement_deadline,
      internal_deadline: claim.internal_deadline,
      lawyer_review_status: claim.lawyer_review_status,
      deadline_status: claim.deadline_status,
      opened_at: claim.opened_at,
      ai_summary: String(claim.ai_summary || '').slice(0, 10000)
    }),
    structured_records: {
      banking: parseJson(claim.banking_json),
      representative: parseJson(claim.representative_json),
      vehicle: parseJson(claim.vehicle_json),
      driver: parseJson(claim.driver_json),
      owner: parseJson(claim.owner_json),
      witnesses: parseJson(claim.witnesses_json, []),
      claim_amounts: parseJson(claim.claim_amounts_json),
      required_forms: parseJson(claim.required_forms_json, [])
    }
  };
}

export async function reviewMissingTemplateFieldsWithAi({ claim, firm, fields, data }) {
  const emptyFields = fields.filter((field) => !hasValue(data[field.name]));
  const protectedFields = emptyFields.filter((field) => (
    String(field.field_type || '').toLowerCase() === 'signature'
    || /\b(signature|signed by|initials?)\b/i.test(`${field.name} ${field.label}`)
  ));
  const protectedNames = new Set(protectedFields.map((field) => field.name));
  const reviewableFields = emptyFields.filter((field) => !protectedNames.has(field.name));
  const protectedDecisions = protectedFields.map((field) => ({
    field_name: field.name,
    label: field.label,
    status: 'protected',
    value: null,
    source: null,
    reason: 'Signature and initial fields require a person to complete them.',
    confidence: 1
  }));

  if (!reviewableFields.length) {
    return { checked: emptyFields.length, values: {}, decisions: protectedDecisions };
  }

  const aiProfile = parseJson(claim.ai_structured_json, { documents: [] });
  const documents = (Array.isArray(aiProfile.documents) ? aiProfile.documents : []).map((document) => {
    const extraction = document?.extraction || {};
    return {
      category: document.category,
      filename: document.filename,
      summary: extraction.summary,
      parties: extraction.parties,
      accident: extraction.accident,
      medical: extraction.medical,
      employment: extraction.employment,
      banking: extraction.banking,
      expenses: extraction.expenses,
      facts: extraction.facts,
      template_values: extraction.template_values,
      extracted_text: String(extraction.extracted_text || '').slice(0, 6000),
      warnings: extraction.warnings
    };
  });
  const knownValues = Object.fromEntries(Object.entries(data || {}).filter(([, value]) => hasValue(value)));
  const recordContext = buildClaimRecordContext(claim, firm);

  if (!config.openAiApiKey || !documents.length) {
    return {
      checked: emptyFields.length,
      values: {},
      decisions: [
        ...protectedDecisions,
        ...reviewableFields.map((field) => ({
          field_name: field.name,
          label: field.label,
          status: 'no_evidence',
          value: null,
          source: null,
          reason: documents.length ? 'AI field review is not configured.' : 'No extracted document evidence is available.',
          confidence: 1
        }))
      ]
    };
  }

  try {
    const openai = createOpenAI({ apiKey: config.openAiApiKey });
    const { output } = await generateText({
      model: openai(config.aiExtractionModel),
      output: Output.object({
        schema: templateFieldReviewSchema,
        name: 'raf_template_field_review',
        description: 'One evidence decision for every empty RAF template field'
      }),
      prompt: `Review every empty template field against the verified RAF claim evidence.

Rules:
- Return exactly one decision for every field_name supplied.
- Work only with the current claim and client context below. Never use another client's record.
- Use fillable only when the uploaded documents or known record values directly support an exact value.
- Use no_evidence when no reliable value exists. Never guess, calculate, or invent a value.
- Use conflict when sources disagree or the correct person/entity is unclear.
- Do not supply signatures, initials, attestations, declarations of truth, or professional certifications.
- Do not copy a driver, witness, police officer, doctor, or unrelated person's details into claimant fields.
- Keep identifiers, reference numbers, dates, monetary values, and names exactly as supported by the evidence.
- The value must suit the field type. Confidence is from 0 to 1.

Complete template input structure:
${JSON.stringify(fields.map((field) => ({
  field_name: field.name,
  label: field.label,
  field_type: field.field_type,
  required: Boolean(field.required),
  current_value: hasValue(data[field.name]) ? data[field.name] : null
})))}

Empty fields:
${JSON.stringify(reviewableFields.map((field) => ({
  field_name: field.name,
  label: field.label,
  field_type: field.field_type,
  required: Boolean(field.required)
})))}

Known populated record values:
${JSON.stringify(knownValues)}

Current firm, client, claim, and related record context:
${JSON.stringify(recordContext)}

Uploaded document evidence:
${JSON.stringify(documents)}`,
      timeout: { totalMs: 120000 }
    });

    const returned = new Map((output.decisions || []).map((decision) => [decision.field_name, decision]));
    const decisions = reviewableFields.map((field) => {
      const decision = returned.get(field.name);
      if (!decision) {
        return {
          field_name: field.name,
          label: field.label,
          status: 'no_evidence',
          value: null,
          source: null,
          reason: 'AI returned no supported value for this field.',
          confidence: 0
        };
      }
      const canFill = decision.status === 'fillable' && hasValue(decision.value) && Number(decision.confidence) >= 0.72;
      return {
        ...decision,
        label: field.label,
        status: canFill ? 'fillable' : decision.status === 'conflict' ? 'conflict' : 'no_evidence',
        value: canFill ? decision.value : null
      };
    });
    const values = Object.fromEntries(
      decisions.filter((decision) => decision.status === 'fillable').map((decision) => [decision.field_name, decision.value])
    );
    return { checked: emptyFields.length, values, decisions: [...protectedDecisions, ...decisions] };
  } catch (error) {
    return {
      checked: emptyFields.length,
      values: {},
      error: String(error?.message || error).slice(0, 1000),
      decisions: [
        ...protectedDecisions,
        ...reviewableFields.map((field) => ({
          field_name: field.name,
          label: field.label,
          status: 'review_failed',
          value: null,
          source: null,
          reason: 'AI could not review this field. Staff review is required.',
          confidence: 0
        }))
      ]
    };
  }
}

function saveConsolidatedExtraction(firmDb, claim, upload, request, extraction) {
  const current = parseJson(claim.ai_structured_json, { documents: [] });
  const documents = Array.isArray(current.documents) ? current.documents.filter((item) => Number(item.upload_id) !== Number(upload.id)) : [];
  documents.push({
    upload_id: upload.id,
    request_id: request.id,
    category: request.label,
    filename: upload.original_filename,
    processed_at: new Date().toISOString(),
    extraction
  });
  const summaries = documents.map((item) => `${item.category}: ${item.extraction?.summary || ''}`).filter(Boolean);
  const consolidated = { version: 1, documents, latest_upload_id: upload.id };

  firmDb.prepare(`
    UPDATE raf_cases
    SET ai_structured_json = ?, ai_summary = ?, ai_updated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(JSON.stringify(consolidated), summaries.join('\n'), claim.id);

  firmDb.prepare(`
    UPDATE client_uploads
    SET ai_status = 'completed', ai_model = ?, ai_extracted_json = ?, ai_summary = ?, ai_error = NULL,
      ai_processed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(config.aiExtractionModel, JSON.stringify(extraction), extraction.summary, upload.id);
}

export async function processUploadedDocumentWithAi({ firmDb, uploadId }) {
  const upload = firmDb.prepare('SELECT * FROM client_uploads WHERE id = ?').get(uploadId);
  if (!upload) return { status: 'error', error: 'Upload record not found' };
  const request = firmDb.prepare('SELECT * FROM client_document_requests WHERE id = ?').get(upload.request_id);
  const claim = request ? firmDb.prepare(`
    SELECT raf_cases.*, firm_clients.first_name, firm_clients.surname, firm_clients.id_number,
      firm_clients.passport_number, firm_clients.date_of_birth, firm_clients.residential_address,
      firm_clients.occupation, firm_clients.employer_details, firm_clients.banking_json
    FROM raf_cases
    JOIN firm_clients ON firm_clients.id = raf_cases.client_id
    WHERE raf_cases.id = ?
  `).get(request.case_id) : null;

  if (!request || !claim) return { status: 'error', error: 'Claim document request was not found' };
  if (!config.openAiApiKey) {
    const error = 'OPENAI_API_KEY is not configured';
    firmDb.prepare(`
      UPDATE client_uploads SET ai_status = 'skipped', ai_error = ?, ai_processed_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(error, upload.id);
    return { status: 'skipped', error };
  }

  try {
    firmDb.prepare("UPDATE client_uploads SET ai_status = 'processing', ai_error = NULL WHERE id = ?").run(upload.id);
    const filePath = resolveInside(clientUploadsDir, upload.stored_filename);
    const fileBuffer = fs.readFileSync(filePath);
    const templateFields = buildTemplateFieldPrompt(firmDb, claim.id);
    const output = await generateDocumentExtractionWithOpenAi({ request, claim, templateFields, upload, fileBuffer });
    const extractedClaimant = output.parties.find((party) => /claimant|client|patient|injured/i.test(party.role)) || output.parties[0] || {};
    const identityMismatch = !personMatchesClaim(extractedClaimant, claim);
    if (identityMismatch) {
      output.warnings = [
        ...(Array.isArray(output.warnings) ? output.warnings : []),
        `Extracted person details do not match matter client ${claim.first_name} ${claim.surname}. Verify this upload before relying on it.`
      ];
      saveConsolidatedExtraction(firmDb, claim, upload, request, output);
      const reviewMessage = `Extracted person details do not match matter client ${claim.first_name} ${claim.surname}. Staff review is required before using this document.`;
      firmDb.prepare(`
        UPDATE client_uploads
        SET ai_status = 'review_required', ai_model = ?, ai_error = ?, ai_processed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(config.aiExtractionModel, reviewMessage, upload.id);
      return { status: 'review_required', extraction: output, filledTemplates: 0, error: reviewMessage };
    }

    updateRelevantClaimFields(firmDb, claim, output);
    saveConsolidatedExtraction(firmDb, claim, upload, request, output);
    const filledTemplates = await autofillAttachedTemplates(firmDb, claim.id, output);
    return { status: 'completed', extraction: output, filledTemplates };
  } catch (error) {
    const message = String(error?.message || error).slice(0, 2000);
    firmDb.prepare(`
      UPDATE client_uploads
      SET ai_status = 'failed', ai_model = ?, ai_error = ?, ai_processed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(config.aiExtractionModel, message, upload.id);
    return { status: 'failed', error: message };
  }
}
