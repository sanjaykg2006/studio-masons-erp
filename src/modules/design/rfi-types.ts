// Pure RFI types — safe to import from client components.

export type RfiStatus = "open" | "answered" | "closed";

export const RFI_STATUS_LABEL: Record<RfiStatus, string> = {
  open: "Open",
  answered: "Answered",
  closed: "Closed",
};

export type RfiRow = {
  id: string;
  from_department_id: string | null;
  from_label: string | null;
  to_department_id: string;
  to_label: string;
  subject: string;
  status: RfiStatus;
  current_role_id: string | null;
  current_role_label: string | null;
  current_role_rank: number | null;
  can_escalate: boolean;
  escalation_level: number;
  raised_by: string;
  raiser_name: string | null;
  message_count: number;
  can_answer: boolean;
  can_manage: boolean;
  created_at: string;
  answered_at: string | null;
  closed_at: string | null;
};

export type RfiMessage = {
  id: string;
  author_id: string;
  author_name: string | null;
  body: string;
  is_answer: boolean;
  created_at: string;
};

export type RfiAttachment = {
  id: string;
  message_id: string;
  name: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  created_at: string;
};

export type DepartmentRef = { id: string; key: string; label: string };
