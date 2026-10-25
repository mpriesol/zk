import type { AppState } from "../lib/types.ts";
export interface SquirrelEvent {
  ids: string[];
  text: string;
  view: string;
}
export function chooseSquirrelEvent(
  state: AppState,
  seen: string[],
  count: number,
  {
    blocked = false,
    reduced = false,
  }: { blocked?: boolean; reduced?: boolean } = {},
): SquirrelEvent | null {
  if (
    blocked ||
    reduced ||
    !state.me.animations ||
    count >= state.course.squirrelLimit
  )
    return null;
  const messages = state.messages.filter(
    (m) =>
      m.status === "sent" &&
      m.important &&
      !m.readAt &&
      !seen.includes(`m-${m.id}`),
  );
  const awards = state.awards.filter(
    (a) => a.memberId === state.me.id && !seen.includes(`a-${a.id}`),
  );
  const challenges = state.challenges.filter(
    (c) =>
      c.status === "published" &&
      !c.hidden &&
      c.publishedAt &&
      !seen.includes(`c-${c.id}`),
  );
  if (messages.length)
    return {
      ids: messages.map((m) => `m-${m.id}`),
      text: "Máš dôležitú správu od organizátorov.",
      view: "messages",
    };
  if (awards.length)
    return {
      ids: awards.map((a) => `a-${a.id}`),
      text:
        awards.length === 1
          ? "Do tvojej zbierky pribudol drahokam."
          : `Do tvojej zbierky pribudli ${awards.length} odmeny.`,
      view: "challenges",
    };
  if (challenges.length)
    return {
      ids: challenges.map((c) => `c-${c.id}`),
      text: "Organizátori sprístupnili novú výzvu.",
      view: "challenges",
    };
  return seen.includes("welcome")
    ? null
    : {
        ids: ["welcome"],
        text: "Vitaj na našej zimnej ceste. Každý svojím tempom.",
        view: "home",
      };
}
