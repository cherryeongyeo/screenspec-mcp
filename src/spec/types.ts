/** Raw Figma node as returned by the REST API (subset we rely on). */
export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  characters?: string;
  componentProperties?: Record<string, { type: string; value: string | boolean }>;
  children?: FigmaNode[];
}

export interface Field {
  /** Label as written in Figma, e.g. "Policy", "화면 목적" */
  label: string;
  value: string;
  /** false when the value is empty or still the template placeholder */
  filled: boolean;
}

export interface SpecItem {
  no: number;
  /** Element reference, e.g. "M-07-1" */
  ref: string;
  name: string;
  nodeId: string;
  pm: Field[];
  design: Field[];
}

export interface FeedbackRow {
  element: string;
  type: string;
  jiraKey: string;
  epic?: string;
  summary: string;
  lastComment?: string;
  lastCommentMeta?: string;
  flow?: string;
  status: string;
  fixVersion?: string;
  nodeId: string;
}

export interface ChangeLogRow {
  version: string;
  date: string;
  role: string;
  author: string;
  change: string;
}

export interface ScreenSpec {
  screenId: string;
  title: string;
  summary: string;
  version: string;
  status: string;
  owners: { role: string; name: string }[];
  nodeId: string;
  figmaUrl?: string;
  isTemplate: boolean;
  overview: Field[];
  items: SpecItem[];
  feedback: FeedbackRow[];
  feedbackLastSynced?: string;
  changeLog: ChangeLogRow[];
}
