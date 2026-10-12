import { readFileSync, existsSync } from "node:fs";
import { TEMPLATE_PLACEHOLDERS } from "./placeholders.generated.js";

/**
 * Public, generic configuration. Team-specific values (Jira project key,
 * status names, label rules) live in a private JSON file pointed to by
 * SCREENSPEC_CONFIG and are merged over these defaults.
 */
export interface Config {
  /** Text(s) that mark a frame as a screen spec document */
  screenFrameMarker: string | string[];
  /** Depth used when scanning a whole file for screen specs */
  scanDepth: number;
  /** Values that count as "not written yet" (template guide text) */
  placeholders: string[];
  feedback: {
    /** Jira statuses treated as closed when collecting open feedback */
    doneStatuses: string[];
    /** Header label -> FeedbackRow key */
    columns: Record<string, string>;
  };
  ticket: {
    projectKey?: string;
    defaultIssueType: string;
    /** Tokens: {screenId} {ref} {itemName} {intent} */
    summaryTemplate: string;
    /** Extra labels added to every draft; the screen ID is always added */
    labels: string[];
    /** PM field labels used for each ticket section */
    sections: {
      background: string[];
      scope: string[];
      policy: string[];
      states: string[];
      exceptions: string[];
    };
  };
}

export const DEFAULT_PLACEHOLDERS = [
  ...TEMPLATE_PLACEHOLDERS,
  "",
  "[화면ID]",
  "화면명",
  "요소명",
  "YYYY-MM-DD",
  "@이름",
  "@담당자",
  "Text",
  "이 화면을 한 문장으로 설명합니다. (예: 사용자가 신문 지면을 열람하는 최상위 기준 화면)",
  "이 화면에서 사용자가 무엇을 하는지",
  "어느 화면 / 어떤 동작으로 진입하는지 (예: D-02 아이콘 레일 → 썸네일 버튼 클릭)",
  "이 요소가 제공하는 기능과 사용 목적",
  "노출 문구 · 데이터 · 노출 조건 (예: 로그인 시에만 노출)",
  "클릭/탭/입력 시 어떻게 동작하는지, 이동 화면",
  "존재하는 상태 (Default / Empty / Error / Disabled …)",
  "입력 제한, 권한, 정렬 기준 등 정책",
  "입력 제한, 권한, 정- 렬 기준 등 정책",
  "예외 상황과 처리 방식",
  "크기 · 여백 · 정렬 · Grid (spacing 토큰)",
  "Font / Size / Weight / Line Height",
  "Text · Background · Border (토큰명 + HEX)",
  "사용 컴포넌트 / Variant명",
  "Default · Hover · Active · Focus · Disabled · Loading",
  "Transition · Animation · Tooltip · Toast",
  "Desktop / Tablet / Mobile 변화",
  "Icon · Image · Illustration · Lottie",
];

export const DEFAULT_CONFIG: Config = {
  screenFrameMarker: ["화면정의서", "Screen Spec"],
  scanDepth: 4,
  placeholders: DEFAULT_PLACEHOLDERS,
  feedback: {
    doneStatuses: ["종료", "검수완료", "Done", "Closed", "Approved"],
    columns: {
      요소: "element",
      유형: "type",
      Jira: "jira",
      "피드백 내용": "summary",
      "최근 댓글": "comment",
      "요청 → 담당": "flow",
      상태: "status",
      "반영 버전": "fixVersion",
      Element: "element",
      Type: "type",
      Feedback: "summary",
      "Latest comment": "comment",
      "Requester → Owner": "flow",
      Status: "status",
      "Fix version": "fixVersion",
    },
  },
  ticket: {
    defaultIssueType: "작업",
    summaryTemplate: "[{ref}] {itemName} {intent}",
    labels: [],
    sections: {
      background: ["기능", "Function"],
      scope: ["콘텐츠", "Content", "Interaction"],
      policy: ["Policy"],
      states: ["State"],
      exceptions: ["Exception"],
    },
  },
};

function merge<T>(base: T, over: unknown): T {
  if (Array.isArray(base) || typeof base !== "object" || base === null) {
    return (over === undefined ? base : over) as T;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries((over as Record<string, unknown>) ?? {})) {
    out[k] = k in out ? merge(out[k], v) : v;
  }
  return out as T;
}

export function loadConfig(path = process.env.SCREENSPEC_CONFIG): Config {
  if (!path || !existsSync(path)) return DEFAULT_CONFIG;
  const user = JSON.parse(readFileSync(path, "utf8"));
  const cfg = merge(DEFAULT_CONFIG, user);
  // placeholders are additive so teams can extend instead of replace
  if (Array.isArray(user.placeholders)) {
    cfg.placeholders = [...DEFAULT_PLACEHOLDERS, ...user.placeholders];
  }
  return cfg;
}

export const markers = (cfg: Config) =>
  Array.isArray(cfg.screenFrameMarker) ? cfg.screenFrameMarker : [cfg.screenFrameMarker];
