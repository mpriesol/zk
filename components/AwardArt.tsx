import {
  Snowflake,
  Droplet,
  Compass,
  MountainSnow,
  Backpack,
  Tent,
  Flame,
  Leaf,
  Star,
  Heart,
  Moon,
  Sun,
  Footprints,
  Wrench,
  Hand,
  PawPrint,
  Handshake,
  Cable,
  Award,
  Check,
  Bandage,
  Nut,
} from "lucide-react";
import type { RewardVisual } from "../lib/types";
import { Gem } from "./ui";

export const AWARD_ICONS = [
  ["snowflake", "Vločka"],
  ["drop", "Kvapka"],
  ["compass", "Kompas"],
  ["mountain", "Hora"],
  ["backpack", "Batoh"],
  ["tent", "Stan"],
  ["flame", "Oheň"],
  ["leaf", "List"],
  ["star", "Hviezda"],
  ["heart", "Srdce"],
  ["moon", "Mesiac"],
  ["sun", "Slnko"],
  ["footprints", "Stopy"],
  ["tool", "Náradie"],
  ["glove", "Rukavica"],
  ["bear", "Medvedík"],
  ["boot", "Topánka"],
  ["knot", "Uzol"],
  ["handshake", "Parťák"],
  ["patch", "Nášivka"],
  ["nut", "Oriešok"],
] as const;
const icons = {
  snowflake: Snowflake,
  drop: Droplet,
  compass: Compass,
  mountain: MountainSnow,
  backpack: Backpack,
  tent: Tent,
  flame: Flame,
  leaf: Leaf,
  star: Star,
  heart: Heart,
  moon: Moon,
  sun: Sun,
  footprints: Footprints,
  tool: Wrench,
  glove: Hand,
  bear: PawPrint,
  boot: Footprints,
  knot: Cable,
  handshake: Handshake,
  patch: Bandage,
  nut: Nut,
};
const gemKeys = ["rhythm", "foot", "support", "variety", "equipment"];
export function stableGemIndex(key: string) {
  const known = gemKeys.indexOf(key);
  return known >= 0
    ? known
    : [...key].reduce((n, c) => n + c.charCodeAt(0), 0) % 5;
}
export default function AwardArt({
  visual,
  rewardKey = "rhythm",
  earned = false,
  label = "",
}: {
  visual?: RewardVisual;
  rewardKey?: string;
  earned?: boolean;
  label?: string;
}) {
  if (!visual || visual.kind === "gem")
    return (
      <Gem
        earned={earned}
        index={stableGemIndex(visual?.value || rewardKey)}
        color={visual?.color}
      />
    );
  const Icon = icons[visual.value as keyof typeof icons] || Award;
  return (
    <span
      className={`award-art ${earned ? "earned" : "locked"} ${visual.kind === "image" ? "image-art" : ""}`}
      style={
        visual.color
          ? ({ "--award-color": visual.color } as React.CSSProperties)
          : undefined
      }
      aria-hidden="true"
    >
      {visual.kind === "image" && visual.url ? (
        <img src={visual.url} alt={label} loading="lazy" />
      ) : (
        <Icon size={31} strokeWidth={1.6} />
      )}
      {earned && (
        <span className="award-art-check">
          <Check size={11} />
        </span>
      )}
    </span>
  );
}
