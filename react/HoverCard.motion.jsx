import React from "react";
import { motion } from "framer-motion";

function hexToRgb(hex) {
  const normalized = String(hex || "")
    .trim()
    .replace("#", "");
  const safe = normalized.length === 3
    ? normalized.split("").map((char) => `${char}${char}`).join("")
    : normalized;
  const isValid = /^[\da-fA-F]{6}$/.test(safe);
  if (!isValid) return { r: 11, g: 61, b: 145 };
  return {
    r: parseInt(safe.slice(0, 2), 16),
    g: parseInt(safe.slice(2, 4), 16),
    b: parseInt(safe.slice(4, 6), 16),
  };
}

function isDarkColor(hex) {
  const { r, g, b } = hexToRgb(hex);
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luma < 0.58;
}

export default function HoverCardMotion({
  type = "team",
  name,
  imageUrl,
  teamColor = "#0b3d91",
  subtitle = "",
  meta = "",
}) {
  const isTeam = type === "team";
  const { r, g, b } = hexToRgb(teamColor);
  const dark = isDarkColor(teamColor);

  const overlayBg = isTeam ? `rgb(${r} ${g} ${b})` : `rgba(${r}, ${g}, ${b}, 0.18)`;
  const hoverText = isTeam ? (dark ? "#ffffff" : "#1a1a1a") : "#1a1a1a";

  return (
    <motion.article
      initial={false}
      whileHover={{ scale: 1.02, y: -3 }}
      transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
      className="group relative overflow-hidden rounded-[22px] p-4 grid grid-cols-[84px_1fr] gap-3.5 items-center bg-white/60 backdrop-blur-[10px] shadow-[0_10px_26px_rgba(11,61,145,0.08),inset_0_1px_0_rgba(255,255,255,0.9)] hover:shadow-[0_12px_40px_rgba(11,61,145,0.2),inset_0_1px_0_rgba(255,255,255,0.9)]"
    >
      <motion.div
        aria-hidden="true"
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        whileHover={{ opacity: 1 }}
        transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
        style={{ background: overlayBg }}
      />

      <motion.div
        aria-hidden="true"
        className="relative z-[1] w-[84px] h-[84px] rounded-[18px] overflow-hidden bg-white/75 grid place-items-center"
        initial={{ x: -26, opacity: 0.08 }}
        whileHover={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
      >
        {imageUrl ? (
          <img src={imageUrl} alt="" loading="lazy" className="w-full h-full object-cover" />
        ) : (
          <span className="text-[1.15rem] font-bold" style={{ color: teamColor }}>
            {name?.slice(0, 2)}
          </span>
        )}
      </motion.div>

      <div className="relative z-[1]">
        <motion.p
          className="m-0 text-[0.72rem] uppercase tracking-[0.08em]"
          initial={false}
          whileHover={{ color: hoverText }}
          style={{ color: "#555" }}
          transition={{ duration: 0.3 }}
        >
          {isTeam ? "Team" : "Player"}
        </motion.p>
        <motion.h3
          className="my-1 text-[1.1rem] font-semibold"
          initial={false}
          whileHover={{ color: hoverText }}
          style={{ color: "#1a1a1a" }}
          transition={{ duration: 0.3 }}
        >
          {name}
        </motion.h3>
        {subtitle ? (
          <motion.p
            className="m-0"
            initial={false}
            whileHover={{ color: hoverText }}
            style={{ color: "#555" }}
            transition={{ duration: 0.3 }}
          >
            {subtitle}
          </motion.p>
        ) : null}
        {meta ? (
          <motion.small
            className="block mt-2"
            initial={false}
            whileHover={{ color: hoverText }}
            style={{ color: "#888" }}
            transition={{ duration: 0.3 }}
          >
            {meta}
          </motion.small>
        ) : null}
      </div>
    </motion.article>
  );
}
