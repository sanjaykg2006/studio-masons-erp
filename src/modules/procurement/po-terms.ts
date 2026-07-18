// Standard Studio Masons purchase-order boilerplate — the billing block, the page-1
// notes and the multi-page Annexure of terms & conditions. Kept here so the PDF
// generator stays focused on layout. Text is transcribed from the company's PO format.

export const STUDIO_MASONS = {
  name: "Studio Masons Private Limited",
  billingLines: [
    "No. 699, 7th Main, 2nd Floor, HAL 2nd Stage",
    "Indiranagar, Bangalore 560008",
    "GSTIN : 29ABFCS4554A1ZE",
    "Place of Supply: Karnataka",
  ],
  footerLines: [
    "Registered Address : No.699, 2nd Floor, 7th Main Road, HAL 2nd Stage, Indiranagar, Bangalore-560008",
    "Communication Address: First Floor, 1074/B, 11th Main Rd, Indiranagar, Bangalore - 560038",
    "Call: 080-416 244 94, Web:www.studio-masons.com",
    "CIN No: U45202KA2021PTC143972",
  ],
};

// Studio Masons' GST-registered branch addresses. The PO billing block can be
// issued from any of these — the user picks one when generating the PO. Each
// entry's billingLines mirror exactly how the block renders (address + GSTIN +
// place of supply). Karnataka (Bangalore) is the default / head office.
export interface BillingBranch {
  id: string;
  label: string;        // shown in the dropdown
  gstin: string;
  billingLines: string[];
}

export const BILLING_BRANCHES: BillingBranch[] = [
  {
    id: "KA",
    label: "Karnataka — Bangalore (Head Office)",
    gstin: "29ABFCS4554A1ZE",
    billingLines: [
      "No. 699, 7th Main, 2nd Floor, HAL 2nd Stage",
      "Indiranagar, Bangalore 560008",
      "GSTIN : 29ABFCS4554A1ZE",
      "Place of Supply: Karnataka",
    ],
  },
  {
    id: "UP",
    label: "Uttar Pradesh — Noida",
    gstin: "09ABFCS4554A1ZG",
    billingLines: [
      "Desk No WSA99, B-128",
      "Red FM Road, Sector 2",
      "Noida, Gautambuddha Nagar",
      "Uttar Pradesh - 201301",
      "GSTIN : 09ABFCS4554A1ZG",
      "Place of Supply: Uttar Pradesh",
    ],
  },
  {
    id: "HR",
    label: "Haryana — Gurugram",
    gstin: "06ABFCS4554A1ZM",
    billingLines: [
      "Plot No 36, Udyog Vihar",
      "Peer Baba Road, Phase 1",
      "Gurugram",
      "Haryana - 122016",
      "GSTIN : 06ABFCS4554A1ZM",
      "Place of Supply: Haryana",
    ],
  },
  {
    id: "KL",
    label: "Kerala — Idukki",
    gstin: "32ABFCS4554A1ZR",
    billingLines: [
      "No. 51, Ward No. 13",
      "Puthenpurayil H K Chappath PO",
      "Alady, Idukki",
      "Kerala - 685505",
      "GSTIN : 32ABFCS4554A1ZR",
      "Place of Supply: Kerala",
    ],
  },
  {
    id: "DL",
    label: "Delhi — New Delhi",
    gstin: "07ABFCS4554A1ZK",
    billingLines: [
      "KH/Mustatli, No-154, Lilla No 19/2",
      "Desk No: E2, 2nd Floor Back Side Office No 4",
      "Master Space Plote NO -27, Najafgarh Dichaon Road",
      "New Delhi, Delhi - 110043",
      "GSTIN : 07ABFCS4554A1ZK",
      "Place of Supply: Delhi",
    ],
  },
  {
    id: "AP",
    label: "Andhra Pradesh — Visakhapatnam",
    gstin: "37ABFCS4554A1ZH",
    billingLines: [
      "No 6-10-27, East Point Colony, Sri Ganga",
      "Mandir Street, Pedda Waltair",
      "Visakhapatnam",
      "Andhra Pradesh - 530017",
      "GSTIN : 37ABFCS4554A1ZH",
      "Place of Supply: Andhra Pradesh",
    ],
  },
  {
    id: "TN",
    label: "Tamil Nadu — Chennai",
    gstin: "33ABFCS4554A1ZP",
    billingLines: [
      "Plot No. 33, Door No.155",
      "Sapthagiri Nagar, Main Road",
      "Sholinganallur, Chennai - 600119",
      "GSTIN : 33ABFCS4554A1ZP",
      "Place of Supply: Tamil Nadu",
    ],
  },
  {
    id: "TG",
    label: "Telangana — Hyderabad",
    gstin: "36ABFCS4554A1ZJ",
    billingLines: [
      "RAM SVR, Plot No 4/2, Sector 1, Rent A Desk",
      "Madhapur, HUDA Techno Enclave",
      "HITEC City, Hyderabad - 500081",
      "GSTIN : 36ABFCS4554A1ZJ",
      "Place of Supply: Telangana",
    ],
  },
  {
    id: "MH",
    label: "Maharashtra — Raigad",
    gstin: "27ABFCS4554A1ZI",
    billingLines: [
      "No. 1513 Room No 2, Pandwadevi Road",
      "Alibag, Poynad, Ambepur, Raigad",
      "Maharashtra - 402108",
      "GSTIN : 27ABFCS4554A1ZI",
      "Place of Supply: Maharashtra",
    ],
  },
];

export const DEFAULT_BILLING_BRANCH_ID = "KA";

// Resolves a branch by id, falling back to the head office if unknown/missing.
export function billingBranch(id?: string): BillingBranch {
  return BILLING_BRANCHES.find((b) => b.id === id) ?? BILLING_BRANCHES[0];
}

// Default payment-term lines (the a/b/c sub-points of note 5). These prefill the
// editable "Payment Terms" field — the user can change them per PO.
export const DEFAULT_PAYMENT_TERMS = [
  "GST 18% Applicable",
  "100% Advance Payment Excluding GST will be released against acceptance of this PO in writing.",
  "Balance payment will be released within 30 days upon submission of certified original hard copy of the invoice.",
];

// Order the page-1 notes are rendered in. Note "5" is the bold "Billing & Payment
// Terms." header; its sub-points (a/b/c…) come from the payment-terms lines.
export const NOTE_ORDER = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"];

// Default text for each page-1 note. All of these are editable on the PO form — they
// prefill the inputs and the user can change any of them per PO.
export const DEFAULT_NOTES: Record<string, string> = {
  "1": `All further communication should be in the name of "STUDIO MASONS PRIVATE LIMITED"`,
  "2": "Our PO reference has to be indicated in all the documents.",
  "3": "Please acknowledge this PO duly stamped and signed as a token of your acceptance.",
  "4": "Indemnity Clause towards GST: This is to specify that any delay in obtaining credit or loss of credit due to non-disclosure or incorrect disclosure of transactions, taxes in the forms / returns uploaded by the supplier would be recovered from them, including the loss of the credit, interest, etc. to the extent of the damage incurred by us.",
  "5": "Billing & Payment Terms.",
  "6": "Transportation Included",
  "7": "Material loading & Unloading vendor Scope.",
  "8": "GST is applicable , only when GST returns are filled upto date.",
  "9": "PO Number, PO date, HSN Code & delivery address is mandatory to mention in Invoice.",
  "10": "Certified Invoice to be submitted to Bangalore office within 7 days of material delivery along with GTN.",
  "11": "Delivery Address:",
};

// Short labels for the note inputs on the form.
export const NOTE_LABELS: Record<string, string> = {
  "1": "Communication",
  "2": "PO reference",
  "3": "Acknowledgement",
  "4": "GST indemnity",
  "5": "Billing & Payment Terms (heading)",
  "6": "Transportation",
  "7": "Loading & unloading",
  "8": "GST applicability",
  "9": "Invoice mandatory fields",
  "10": "Certified invoice",
  "11": "Delivery address",
};

export interface Page1Note {
  n: string;            // numbering / letter shown in the margin
  text: string;
  bold?: boolean;
  indent?: boolean;     // sub-point (payment term) rendered indented
}

// Assembles the page-1 notes from the user-edited note texts. Note 5 is the bold
// header; the payment-term lines render as its indented a/b/c sub-points.
export function page1Notes(opts: { notes: Record<string, string>; paymentTermsLines: string[] }): Page1Note[] {
  const letters = "abcdefghij".split("");
  const out: Page1Note[] = [];
  for (const k of NOTE_ORDER) {
    const text = opts.notes[k] ?? DEFAULT_NOTES[k] ?? "";
    if (k === "5") {
      out.push({ n: "5", text, bold: true });
      opts.paymentTermsLines.forEach((t, i) => out.push({ n: letters[i] ?? "•", text: t, indent: true }));
    } else {
      out.push({ n: k, text });
    }
  }
  return out;
}

export interface AnnexureRow {
  sl: string;
  title: string;
  description: string;
  remarks: string;
}

export interface AnnexureSection {
  heading: string;
  rows: AnnexureRow[];
}

interface AnnexRowDef {
  sl: string;
  title: string;
  description: string;
  defaultRemark: string;
}
interface AnnexSectionDef {
  heading: string;
  rows: AnnexRowDef[];
}

// Annexure-I — additional terms & conditions, with the standard remark for each row.
const ANNEXURE_DEF: AnnexSectionDef[] = [
  {
    heading: "SCOPE AND TIMELINE",
    rows: [
      { sl: "1", title: "Commencement of work", description: "The work shall commence at site from the date of", defaultRemark: "" },
      { sl: "2", title: "Completion of work", description: "The project to be completed on or before in 100% including rectifications of snag works if any and along with handing over documentation.", defaultRemark: "" },
      { sl: "3", title: "Scope of Work- inclusions", description: "Contractors scope of work shall include", defaultRemark: "As Specified in PO" },
      { sl: "4", title: "Co-ordination with other vendor", description: "It is expected that the contractor shall work in co-ordination with Project Manager / vendor/ contractor of other trades and shall adhere with the milestones mentioned in the summary of contract conditions. Milestone and timeline mentioned doesn't guarantee for a clear work front on day.", defaultRemark: "Applicable" },
    ],
  },
  {
    heading: "PAYMENT TERMS",
    rows: [
      { sl: "5", title: "Defect Liability Period", description: "12 months from the date of last certified bill, completion of snag list submission of as built and all necessary handing over documents which ever is later. Where extended Guarantee periods are stipulated in the Contract Documents for particular parts of the Works, the Contractor shall furnish appropriate guarantees in approved formats for same before issuance of the Final Completion Certificate.", defaultRemark: "NA" },
      { sl: "6", title: "Retention money", description: "5% on total amount of the W.O/P.O", defaultRemark: "NA" },
      { sl: "7", title: "Release of Retention money", description: "Against completion of DLP.", defaultRemark: "NA" },
      { sl: "8", title: "Payment mode", description: "", defaultRemark: "NEFT/RTGS" },
      { sl: "9", title: "Liquidated Damages", description: "In case of delays, Liquidated Damages will be applicable delay in delivery shall be 1% of Total Contract Price per week of delay subject to max of 7.5% of the Total Contract Price. The Contractor shall take full responsibility forth care thereof and for taking precautions to prevent any losses or damages to the Works / Property including the common areas or any part thereof or to any materials, articles at site, and shall be liable for any such losses or damages that may happen for any causes whatsoever and shall at his own cost, repair and make good the same and in conformity acceptable to Client of the said property, failure to which, the compensation towards such losses or damages will be recovered from the payment of bills of the respective contractor.", defaultRemark: "Applicable" },
    ],
  },
  {
    heading: "BILLING",
    rows: [
      { sl: "10", title: "Submission of bills and supporting documents", description: "Bill should be submitted in the format specified by Studio Masons Pvt. Ltd. Project Manager along with supporting documents (material invoices/ delivery challans, measurement sheets & measurement drawings, quality challans etc.) as per checklists, rate analysis, ESI/PF the checklist provided by Project Manager. Certification of bill may be delayed if complete document set are not provided.", defaultRemark: "Applicable" },
      { sl: "11", title: "Bill certification", description: "Bill should be submitted in the format specified by Studio Masons Pvt. Ltd. Project manager along with the supporting documents (material invoices/ delivery challans, measurement sheets & measurement drawings, quality checklists, rate analysis, ESI & GTN) as per the checklist provided by Project manager. Certification of bill may be delayed if complete document set are not provided.", defaultRemark: "Applicable" },
      { sl: "12", title: "Duration of processing payments", description: "Payments shall be made by Studio Masons Pvt. Ltd. Within 45 working days of certification of the bills by the Project managers, on receipt of the certified original Bill @ Office in Hard copy.", defaultRemark: "Applicable" },
      { sl: "13", title: "Invoice Submission", description: "Original invoice copy has to be submitted at Bangalore office within 1 week from the date of dispatch of material or completion of work with certification of quantity/measurement sheets. Invoice submission address : Studio Masons Pvt. Ltd. #699, 2nd Floor, 7th Main Road, HAL 2nd Stage, Indiranagar, Bangalore-560008", defaultRemark: "Applicable" },
      { sl: "14", title: "Rate only items, non-tendered / extra items and quantities exceeding the tendered quantities", description: "For all such items, a written variation/change order signed by Studio Masons Pvt. Ltd. Representative and Project manager has to be immediately obtained before procurement and execution. No payments entertained without the written variation order signed by owner/Architect and Project manager. Prior approval before execution of the Non tendered item is mandatory. The onus shall be on the Contractor to obtain such prior written variation order from the Owner's Representative and the Manager. Commercial closure shall be done with the representative of the Head Office.", defaultRemark: "Applicable" },
      { sl: "15", title: "Measurement of quantities for payment", description: "Payments shall be made only for the quantities actually supplied & installed and measured at site. No additional payment will be made for wastages, any surplus material shall be taken back by the Contractor.", defaultRemark: "NA" },
      { sl: "16", title: "Taxes, Duties and Levies", description: "As Applicable", defaultRemark: "Applicable" },
      { sl: "17", title: "Insurance", description: "Contractor must provide insurance cover for the work and material till site. CAR copy of the insurance policy should be provided to Studio Masons Pvt. Ltd. BOCW & CLRA will be taken by Studio Masons Pvt. Ltd. and the compliance charges as applicable will be borne by contractor.", defaultRemark: "Applicable" },
      { sl: "18", title: "Statutory Audit", description: "Contractors to provide EPF & ESIC registration certificates and remittance details (ECR) copy for statutory audit purpose. Wage register & salary slip of the labours to be provided by contractor for statutory compliance audit, and all the documents, registers to be maintained as per CLRA, MW, BOCW norms. Any documents found not maintained/missing will not be accepted and will be eligible for penalty.", defaultRemark: "NA" },
    ],
  },
  {
    heading: "GENERAL CONDITIONS",
    rows: [
      { sl: "19", title: "Safety Measures", description: "Safety tools & tackles will be contractor responsibility. Any violation of safety will be applicable for penalty as per site safety representative.", defaultRemark: "Applicable" },
      { sl: "20", title: "Safety Penalty", description: "Contractor must execute the work strictly adherence to Safety Policy. For deviation from safety rules penalty shall be levied on contractor as per Safety Policy attached with the purchase order. a) Rs. 1,00,000/- per accident  b) Rs. 10,00,000/- per fatal accident", defaultRemark: "Applicable" },
      { sl: "21", title: "House Keeping & Debris Removal", description: "Contractor to maintain site clean & tidy on day to day basis. If contractor fail to perform, up to 3% debit is applicable on the final contract value if the housekeeping and debris removal works were not done as per client satisfaction.", defaultRemark: "Applicable" },
      { sl: "22", title: "Warranty", description: "Warranty for Equipment's will be as per manufacturers Warranty Certificate. Warranty for the workmanship to be given by contractor in case of supply and installation scope and provide warranty certificate.", defaultRemark: "NA" },
      { sl: "23", title: "Price Escalation", description: "Unless otherwise it is a for measures, no price escalation from the quoted cost is acceptable throughout the project duration till 100% handover of the project.", defaultRemark: "Applicable" },
    ],
  },
  {
    heading: "SITE FACILITIES",
    rows: [
      { sl: "24", title: "Storage facilities", description: "The contractor shall be provided space only for storage at site; construction of store and all other arrangements shall be made by the contractor.", defaultRemark: "Applicable" },
      { sl: "25", title: "Construction, power, water and house keeping", description: "Housekeeping will be under vendor's scope for his said works and general cleaning. Power & Water shall be provided at one point; further distribution shall be under Vendor's scope. If found housekeeping is not satisfactory, SMPL will deploy housekeeping team and charges will be deducted in final bill.", defaultRemark: "Applicable" },
    ],
  },
  {
    heading: "SITE ACTIVITY",
    rows: [
      { sl: "26", title: "Site Organization Setup", description: "Vendor has to submit the Site organization chart to clearly indicate the Name of Site incharge & other members of the Site Team.", defaultRemark: "Applicable" },
      { sl: "27", title: "Submittals to be submitted within 3 days from receipt of PO.", description: "1. Acceptance to WO/PO. 2) Organization chart. 3) Undated Security cheque", defaultRemark: "Acceptance copy required." },
    ],
  },
  {
    heading: "VENDOR RESPONSIBILITIES",
    rows: [
      { sl: "28", title: "Progress Review meeting", description: "Progress Review meeting will be conducted every week on a particular day. Regional Incharge also has to participate in the meeting.", defaultRemark: "NA" },
      { sl: "29", title: "Packing", description: "The Materials will be packed appropriately to reduce any chances of damage to the material during transit. Packing of material shall also confirm to the requirement of insurance. All materials packed in wood have to be accompanied by Phytosanitary Certificate issued by competent authorities at the Country of Origin. The material used for packing shall confirm to all government norms.", defaultRemark: "All inclusive" },
      { sl: "30", title: "Compliance of Safety Norms, Environment and Health at Project Site", description: "You shall comply with all the safety norms, environment aspects pertaining to but not limited to disposal of civil construction materials away from the water source, drains etc. and also be responsible for the health of the workers. You alone shall be liable for any breach or violation thereof and shall keep us indemnified against any loss or damage suffered by us on this account. You shall make all necessary arrangements for the required tools, tackles and other safety equipments like helmet, gloves & shoes, safety belts etc for your persons. In addition to the above, it is the duty of the contractor to get medical examination of the workers on occupational health and safety aspects.", defaultRemark: "Applicable" },
      { sl: "31", title: "Contact Details for Supply, installation, Testing & Commissioning order", description: "As mentioned in the delivery address / contact details specified in this Purchase Order.", defaultRemark: "As mentioned" },
    ],
  },
];

// Rows whose remarks the user fills in per PO (the rest carry their standard remark).
// Rows 1 & 2 use the dedicated commencement/completion date inputs instead.
export const VARIABLE_REMARK_SLS = new Set(["5", "6", "7", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30", "31"]);

// Flattened list of the rows whose remarks are user-entered, with their defaults —
// used to build the "Annexure remarks" inputs on the PO form.
export function variableRemarkRows(): Array<{ sl: string; title: string; defaultRemark: string }> {
  return ANNEXURE_DEF.flatMap((s) => s.rows)
    .filter((r) => VARIABLE_REMARK_SLS.has(r.sl))
    .map((r) => ({ sl: r.sl, title: r.title, defaultRemark: r.defaultRemark }));
}

// Builds the annexure sections, applying the commencement/completion dates (rows 1/2)
// and any user-entered remarks (variable rows); other rows keep their standard remark.
export function annexure(opts: { commencement?: string; completion?: string; remarks?: Record<string, string> }): AnnexureSection[] {
  const remarkFor = (r: AnnexRowDef): string => {
    if (r.sl === "1") return opts.commencement || r.defaultRemark;
    if (r.sl === "2") return opts.completion || r.defaultRemark;
    if (VARIABLE_REMARK_SLS.has(r.sl)) {
      const v = opts.remarks?.[r.sl];
      return v !== undefined && v !== "" ? v : r.defaultRemark;
    }
    return r.defaultRemark;
  };
  return ANNEXURE_DEF.map((s) => ({
    heading: s.heading,
    rows: s.rows.map((r) => ({ sl: r.sl, title: r.title, description: r.description, remarks: remarkFor(r) })),
  }));
}
