import React from "react";
import "./hover-card.css";

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

export default function HoverCard({
  type = "team",
  name,
  imageUrl,
  teamColor = "#0b3d91",
  subtitle = "",
  meta = "",
}) {
  const { r, g, b } = hexToRgb(teamColor);
  const isTeam = type === "team";
  const dark = isDarkColor(teamColor);
  const hoverBg = isTeam ? `rgb(${r} ${g} ${b})` : `rgba(${r}, ${g}, ${b}, 0.18)`;
  const textOnHover = isTeam ? (dark ? "#ffffff" : "#1a1a1a") : "#1a1a1a";

  return (
    <article
      className={`hover-card hover-card--${type}`}
      style={{
        "--hover-bg": hoverBg,
        "--team-color": teamColor,
        "--hover-text": textOnHover,
      }}
    >
      <div className="hover-card__media" aria-hidden="true">
        {imageUrl ? <img src={imageUrl} alt="" loading="lazy" /> : <span>{name?.slice(0, 2)}</span>}
      </div>

      <div className="hover-card__content">
        <p className="hover-card__kicker">{isTeam ? "Team" : "Player"}</p>
        <h3>{name}</h3>
        {subtitle ? <p className="hover-card__subtitle">{subtitle}</p> : null}
        {meta ? <small>{meta}</small> : null}
      </div>
    </article>
  );
}
